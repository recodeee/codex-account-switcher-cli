#![cfg_attr(not(test), allow(dead_code))]

use std::{
    future::Future,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use tokio::task::JoinHandle;
use tracing::warn;

pub(crate) type SchedulerFuture<'a> = Pin<Box<dyn Future<Output = ()> + Send + 'a>>;

pub(crate) trait RuntimeSchedulerJob: Send + Sync + 'static {
    fn name(&self) -> &'static str;

    fn enabled(&self) -> bool {
        true
    }

    fn interval(&self) -> Duration;

    fn run_once<'a>(&'a self) -> SchedulerFuture<'a>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SchedulerLifecycleStatus {
    Started,
    AlreadyRunning,
    Disabled,
    Stopped,
    NotRunning,
    Missing,
}

pub(crate) type SchedulerBatchStatus = Vec<(&'static str, SchedulerLifecycleStatus)>;

pub(crate) struct RuntimeSchedulerLifecycle {
    jobs: Vec<RegisteredSchedulerJob>,
}

struct RegisteredSchedulerJob {
    job: Arc<dyn RuntimeSchedulerJob>,
    control: Option<RunningSchedulerTask>,
}

struct RunningSchedulerTask {
    stop_flag: Arc<AtomicBool>,
    task: JoinHandle<()>,
}

impl RuntimeSchedulerLifecycle {
    pub(crate) fn new(jobs: Vec<Arc<dyn RuntimeSchedulerJob>>) -> Self {
        Self {
            jobs: jobs
                .into_iter()
                .map(|job| RegisteredSchedulerJob { job, control: None })
                .collect(),
        }
    }

    pub(crate) fn start_all(&mut self) -> SchedulerBatchStatus {
        self.jobs
            .iter_mut()
            .map(|entry| {
                let name = entry.job.name();
                let status = start_entry(entry);
                (name, status)
            })
            .collect()
    }

    pub(crate) fn start_job(&mut self, job_name: &str) -> SchedulerLifecycleStatus {
        let Some(entry) = self
            .jobs
            .iter_mut()
            .find(|entry| entry.job.name() == job_name)
        else {
            return SchedulerLifecycleStatus::Missing;
        };

        start_entry(entry)
    }

    pub(crate) async fn stop_job(&mut self, job_name: &str) -> SchedulerLifecycleStatus {
        let Some(index) = self
            .jobs
            .iter()
            .position(|entry| entry.job.name() == job_name)
        else {
            return SchedulerLifecycleStatus::Missing;
        };

        stop_entry(&mut self.jobs[index]).await
    }

    pub(crate) async fn stop_all_reverse(&mut self) -> SchedulerBatchStatus {
        let mut statuses = Vec::with_capacity(self.jobs.len());
        for entry in self.jobs.iter_mut().rev() {
            let name = entry.job.name();
            let status = stop_entry(entry).await;
            statuses.push((name, status));
        }
        statuses
    }

    pub(crate) async fn shutdown(&mut self) -> SchedulerBatchStatus {
        self.stop_all_reverse().await
    }

    #[cfg(test)]
    fn running_jobs(&self) -> Vec<&'static str> {
        self.jobs
            .iter()
            .filter_map(|entry| {
                entry
                    .control
                    .as_ref()
                    .filter(|control| !control.task.is_finished())
                    .map(|_| entry.job.name())
            })
            .collect()
    }
}

impl Drop for RuntimeSchedulerLifecycle {
    fn drop(&mut self) {
        for entry in &mut self.jobs {
            if let Some(control) = entry.control.take() {
                control.stop_flag.store(true, Ordering::SeqCst);
                control.task.abort();
            }
        }
    }
}

fn start_entry(entry: &mut RegisteredSchedulerJob) -> SchedulerLifecycleStatus {
    if !entry.job.enabled() {
        return SchedulerLifecycleStatus::Disabled;
    }

    if entry
        .control
        .as_ref()
        .is_some_and(|control| !control.task.is_finished())
    {
        return SchedulerLifecycleStatus::AlreadyRunning;
    }

    entry.control = Some(spawn_scheduler_task(Arc::clone(&entry.job)));
    SchedulerLifecycleStatus::Started
}

async fn stop_entry(entry: &mut RegisteredSchedulerJob) -> SchedulerLifecycleStatus {
    let Some(control) = entry.control.take() else {
        return SchedulerLifecycleStatus::NotRunning;
    };

    control.stop_flag.store(true, Ordering::SeqCst);
    control.task.abort();

    match control.task.await {
        Ok(()) => {}
        Err(error) if error.is_cancelled() => {}
        Err(error) => {
            warn!(
                scheduler_job = entry.job.name(),
                error = ?error,
                "scheduler task join failed during stop",
            );
        }
    }

    SchedulerLifecycleStatus::Stopped
}

fn spawn_scheduler_task(job: Arc<dyn RuntimeSchedulerJob>) -> RunningSchedulerTask {
    let stop_flag = Arc::new(AtomicBool::new(false));
    let loop_stop_flag = Arc::clone(&stop_flag);

    let task = tokio::spawn(async move {
        while !loop_stop_flag.load(Ordering::SeqCst) {
            job.run_once().await;
            if loop_stop_flag.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(job.interval()).await;
        }
    });

    RunningSchedulerTask { stop_flag, task }
}

#[cfg(test)]
mod tests {
    use super::{
        RuntimeSchedulerJob, RuntimeSchedulerLifecycle, SchedulerFuture, SchedulerLifecycleStatus,
    };
    use std::{
        sync::{
            Arc,
            atomic::{AtomicBool, AtomicUsize, Ordering},
        },
        time::Duration,
    };

    struct TestSchedulerJob {
        name: &'static str,
        enabled: bool,
        interval: Duration,
        runs: Arc<AtomicUsize>,
        block_forever: bool,
        started_flag: Arc<AtomicBool>,
    }

    impl RuntimeSchedulerJob for TestSchedulerJob {
        fn name(&self) -> &'static str {
            self.name
        }

        fn enabled(&self) -> bool {
            self.enabled
        }

        fn interval(&self) -> Duration {
            self.interval
        }

        fn run_once<'a>(&'a self) -> SchedulerFuture<'a> {
            Box::pin(async move {
                self.started_flag.store(true, Ordering::SeqCst);
                self.runs.fetch_add(1, Ordering::SeqCst);

                if self.block_forever {
                    loop {
                        tokio::time::sleep(Duration::from_secs(60)).await;
                    }
                }
            })
        }
    }

    #[tokio::test]
    async fn start_all_is_idempotent_and_skips_disabled_jobs() {
        let enabled_runs = Arc::new(AtomicUsize::new(0));
        let disabled_runs = Arc::new(AtomicUsize::new(0));

        let enabled_job = Arc::new(TestSchedulerJob {
            name: "usage-refresh",
            enabled: true,
            interval: Duration::from_millis(10),
            runs: Arc::clone(&enabled_runs),
            block_forever: false,
            started_flag: Arc::new(AtomicBool::new(false)),
        });
        let disabled_job = Arc::new(TestSchedulerJob {
            name: "model-refresh",
            enabled: false,
            interval: Duration::from_millis(10),
            runs: Arc::clone(&disabled_runs),
            block_forever: false,
            started_flag: Arc::new(AtomicBool::new(false)),
        });

        let mut lifecycle = RuntimeSchedulerLifecycle::new(vec![enabled_job, disabled_job]);

        assert_eq!(
            lifecycle.start_all(),
            vec![
                ("usage-refresh", SchedulerLifecycleStatus::Started),
                ("model-refresh", SchedulerLifecycleStatus::Disabled),
            ]
        );

        tokio::time::sleep(Duration::from_millis(30)).await;

        assert_eq!(
            lifecycle.start_all(),
            vec![
                ("usage-refresh", SchedulerLifecycleStatus::AlreadyRunning),
                ("model-refresh", SchedulerLifecycleStatus::Disabled),
            ]
        );

        assert!(enabled_runs.load(Ordering::SeqCst) > 0);
        assert_eq!(disabled_runs.load(Ordering::SeqCst), 0);

        let stop = lifecycle.shutdown().await;
        assert_eq!(
            stop,
            vec![
                ("model-refresh", SchedulerLifecycleStatus::NotRunning),
                ("usage-refresh", SchedulerLifecycleStatus::Stopped),
            ]
        );
        assert!(lifecycle.running_jobs().is_empty());
    }

    #[tokio::test]
    async fn shutdown_stops_jobs_in_reverse_registration_order() {
        let usage_job = Arc::new(TestSchedulerJob {
            name: "usage-refresh",
            enabled: true,
            interval: Duration::from_secs(30),
            runs: Arc::new(AtomicUsize::new(0)),
            block_forever: false,
            started_flag: Arc::new(AtomicBool::new(false)),
        });
        let model_job = Arc::new(TestSchedulerJob {
            name: "model-refresh",
            enabled: true,
            interval: Duration::from_secs(30),
            runs: Arc::new(AtomicUsize::new(0)),
            block_forever: false,
            started_flag: Arc::new(AtomicBool::new(false)),
        });
        let sticky_job = Arc::new(TestSchedulerJob {
            name: "sticky-cleanup",
            enabled: true,
            interval: Duration::from_secs(30),
            runs: Arc::new(AtomicUsize::new(0)),
            block_forever: false,
            started_flag: Arc::new(AtomicBool::new(false)),
        });

        let mut lifecycle = RuntimeSchedulerLifecycle::new(vec![usage_job, model_job, sticky_job]);

        assert_eq!(
            lifecycle.start_all(),
            vec![
                ("usage-refresh", SchedulerLifecycleStatus::Started),
                ("model-refresh", SchedulerLifecycleStatus::Started),
                ("sticky-cleanup", SchedulerLifecycleStatus::Started),
            ]
        );

        let stop = lifecycle.shutdown().await;
        assert_eq!(
            stop,
            vec![
                ("sticky-cleanup", SchedulerLifecycleStatus::Stopped),
                ("model-refresh", SchedulerLifecycleStatus::Stopped),
                ("usage-refresh", SchedulerLifecycleStatus::Stopped),
            ]
        );
        assert!(lifecycle.running_jobs().is_empty());
    }

    #[tokio::test]
    async fn stop_job_cancels_blocking_task() {
        let started = Arc::new(AtomicBool::new(false));

        let blocking_job = Arc::new(TestSchedulerJob {
            name: "blocking-job",
            enabled: true,
            interval: Duration::from_secs(1),
            runs: Arc::new(AtomicUsize::new(0)),
            block_forever: true,
            started_flag: Arc::clone(&started),
        });

        let mut lifecycle = RuntimeSchedulerLifecycle::new(vec![blocking_job]);

        assert_eq!(
            lifecycle.start_job("blocking-job"),
            SchedulerLifecycleStatus::Started
        );

        for _ in 0..20 {
            if started.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        assert!(started.load(Ordering::SeqCst));

        let stop_result = tokio::time::timeout(
            Duration::from_millis(200),
            lifecycle.stop_job("blocking-job"),
        )
        .await
        .expect("stop should not hang");

        assert_eq!(stop_result, SchedulerLifecycleStatus::Stopped);
        assert!(lifecycle.running_jobs().is_empty());
    }
}
