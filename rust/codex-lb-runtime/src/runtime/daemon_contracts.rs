#![cfg_attr(not(test), allow(dead_code))]

use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuntimeStatus {
    Online,
    Degraded,
    Offline,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DaemonRuntimeRegistration {
    pub runtime_id: String,
    pub daemon_id: String,
    pub workspace_id: String,
    pub provider: String,
    pub status: RuntimeStatus,
    pub is_registered: bool,
}

impl DaemonRuntimeRegistration {
    pub(crate) fn new(
        runtime_id: impl Into<String>,
        daemon_id: impl Into<String>,
        workspace_id: impl Into<String>,
        provider: impl Into<String>,
    ) -> Self {
        Self {
            runtime_id: runtime_id.into(),
            daemon_id: daemon_id.into(),
            workspace_id: workspace_id.into(),
            provider: provider.into(),
            status: RuntimeStatus::Online,
            is_registered: true,
        }
    }

    pub(crate) fn mark_degraded(&mut self) {
        self.status = RuntimeStatus::Degraded;
    }

    pub(crate) fn mark_offline(&mut self) {
        self.status = RuntimeStatus::Offline;
    }

    pub(crate) fn mark_online(&mut self) {
        self.status = RuntimeStatus::Online;
    }

    pub(crate) fn deregister(&mut self) {
        self.is_registered = false;
        self.status = RuntimeStatus::Offline;
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TaskLifecycleState {
    Queued,
    Claimed,
    Running,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TaskLifecycleError {
    InvalidTransition {
        from: TaskLifecycleState,
        to: TaskLifecycleState,
    },
    LeaseOwnerMismatch,
    ProgressOutOfOrder {
        last_sequence: u64,
        received_sequence: u64,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct DaemonTaskLease {
    pub task_id: String,
    pub runtime_id: String,
    pub state: TaskLifecycleState,
    pub last_progress_sequence: u64,
    heartbeat_ttl: Duration,
    last_heartbeat_age: Duration,
}

impl DaemonTaskLease {
    pub(crate) fn new(
        task_id: impl Into<String>,
        runtime_id: impl Into<String>,
        heartbeat_ttl: Duration,
    ) -> Self {
        Self {
            task_id: task_id.into(),
            runtime_id: runtime_id.into(),
            state: TaskLifecycleState::Queued,
            last_progress_sequence: 0,
            heartbeat_ttl,
            last_heartbeat_age: Duration::ZERO,
        }
    }

    pub(crate) fn claim(&mut self, runtime_id: &str) -> Result<(), TaskLifecycleError> {
        if self.runtime_id != runtime_id {
            return Err(TaskLifecycleError::LeaseOwnerMismatch);
        }

        match self.state {
            TaskLifecycleState::Queued => {
                self.state = TaskLifecycleState::Claimed;
                self.last_heartbeat_age = Duration::ZERO;
                Ok(())
            }
            TaskLifecycleState::Claimed => Ok(()),
            state => Err(TaskLifecycleError::InvalidTransition {
                from: state,
                to: TaskLifecycleState::Claimed,
            }),
        }
    }

    pub(crate) fn start(&mut self) -> Result<(), TaskLifecycleError> {
        match self.state {
            TaskLifecycleState::Claimed => {
                self.state = TaskLifecycleState::Running;
                Ok(())
            }
            TaskLifecycleState::Running => Ok(()),
            state => Err(TaskLifecycleError::InvalidTransition {
                from: state,
                to: TaskLifecycleState::Running,
            }),
        }
    }

    pub(crate) fn report_progress(&mut self, sequence: u64) -> Result<(), TaskLifecycleError> {
        if self.state != TaskLifecycleState::Running {
            return Err(TaskLifecycleError::InvalidTransition {
                from: self.state,
                to: TaskLifecycleState::Running,
            });
        }

        if sequence < self.last_progress_sequence {
            return Err(TaskLifecycleError::ProgressOutOfOrder {
                last_sequence: self.last_progress_sequence,
                received_sequence: sequence,
            });
        }

        self.last_progress_sequence = sequence;
        Ok(())
    }

    pub(crate) fn complete(&mut self) -> Result<(), TaskLifecycleError> {
        match self.state {
            TaskLifecycleState::Running => {
                self.state = TaskLifecycleState::Completed;
                Ok(())
            }
            TaskLifecycleState::Completed => Ok(()),
            state => Err(TaskLifecycleError::InvalidTransition {
                from: state,
                to: TaskLifecycleState::Completed,
            }),
        }
    }

    pub(crate) fn fail(&mut self) -> Result<(), TaskLifecycleError> {
        match self.state {
            TaskLifecycleState::Running => {
                self.state = TaskLifecycleState::Failed;
                Ok(())
            }
            TaskLifecycleState::Failed => Ok(()),
            state => Err(TaskLifecycleError::InvalidTransition {
                from: state,
                to: TaskLifecycleState::Failed,
            }),
        }
    }

    pub(crate) fn cancel(&mut self) -> Result<(), TaskLifecycleError> {
        match self.state {
            TaskLifecycleState::Queued | TaskLifecycleState::Claimed | TaskLifecycleState::Running => {
                self.state = TaskLifecycleState::Cancelled;
                Ok(())
            }
            TaskLifecycleState::Cancelled => Ok(()),
            state => Err(TaskLifecycleError::InvalidTransition {
                from: state,
                to: TaskLifecycleState::Cancelled,
            }),
        }
    }

    pub(crate) fn heartbeat(&mut self, runtime_id: &str) -> Result<(), TaskLifecycleError> {
        if self.runtime_id != runtime_id {
            return Err(TaskLifecycleError::LeaseOwnerMismatch);
        }

        match self.state {
            TaskLifecycleState::Claimed | TaskLifecycleState::Running => {
                self.last_heartbeat_age = Duration::ZERO;
                Ok(())
            }
            state => Err(TaskLifecycleError::InvalidTransition {
                from: state,
                to: state,
            }),
        }
    }

    pub(crate) fn elapse(&mut self, elapsed: Duration) {
        self.last_heartbeat_age = self.last_heartbeat_age.saturating_add(elapsed);
    }

    pub(crate) fn is_stale(&self) -> bool {
        self.last_heartbeat_age > self.heartbeat_ttl
    }
}

#[cfg(test)]
mod tests {
    use super::{
        DaemonRuntimeRegistration, DaemonTaskLease, RuntimeStatus, TaskLifecycleError,
        TaskLifecycleState,
    };
    use std::time::Duration;

    #[test]
    fn runtime_registration_status_transitions_are_explicit() {
        let mut runtime =
            DaemonRuntimeRegistration::new("runtime-1", "daemon-1", "workspace-1", "codex");

        assert_eq!(runtime.status, RuntimeStatus::Online);
        runtime.mark_degraded();
        assert_eq!(runtime.status, RuntimeStatus::Degraded);
        runtime.mark_offline();
        assert_eq!(runtime.status, RuntimeStatus::Offline);
        runtime.mark_online();
        assert_eq!(runtime.status, RuntimeStatus::Online);
    }

    #[test]
    fn runtime_deregister_marks_runtime_offline_and_unregistered() {
        let mut runtime =
            DaemonRuntimeRegistration::new("runtime-1", "daemon-1", "workspace-1", "codex");

        runtime.deregister();

        assert_eq!(runtime.status, RuntimeStatus::Offline);
        assert!(!runtime.is_registered);
    }

    #[test]
    fn task_lifecycle_happy_path_is_deterministic() {
        let mut lease = DaemonTaskLease::new("task-1", "runtime-1", Duration::from_secs(30));

        assert_eq!(lease.state, TaskLifecycleState::Queued);
        assert_eq!(lease.claim("runtime-1"), Ok(()));
        assert_eq!(lease.start(), Ok(()));
        assert_eq!(lease.report_progress(1), Ok(()));
        assert_eq!(lease.complete(), Ok(()));
        assert_eq!(lease.state, TaskLifecycleState::Completed);
    }

    #[test]
    fn task_lifecycle_is_idempotent_for_repeat_status_reports() {
        let mut lease = DaemonTaskLease::new("task-2", "runtime-1", Duration::from_secs(30));

        assert_eq!(lease.claim("runtime-1"), Ok(()));
        assert_eq!(lease.claim("runtime-1"), Ok(()));
        assert_eq!(lease.start(), Ok(()));
        assert_eq!(lease.start(), Ok(()));
        assert_eq!(lease.fail(), Ok(()));
        assert_eq!(lease.fail(), Ok(()));
        assert_eq!(lease.state, TaskLifecycleState::Failed);
    }

    #[test]
    fn progress_requires_running_state_and_monotonic_sequence() {
        let mut lease = DaemonTaskLease::new("task-3", "runtime-1", Duration::from_secs(30));

        assert_eq!(
            lease.report_progress(1),
            Err(TaskLifecycleError::InvalidTransition {
                from: TaskLifecycleState::Queued,
                to: TaskLifecycleState::Running,
            })
        );

        lease.claim("runtime-1").expect("claim should succeed");
        lease.start().expect("start should succeed");

        assert_eq!(lease.report_progress(1), Ok(()));
        assert_eq!(lease.report_progress(1), Ok(()));
        assert_eq!(
            lease.report_progress(0),
            Err(TaskLifecycleError::ProgressOutOfOrder {
                last_sequence: 1,
                received_sequence: 0,
            })
        );
    }

    #[test]
    fn invalid_transition_is_rejected_with_explicit_error() {
        let mut lease = DaemonTaskLease::new("task-4", "runtime-1", Duration::from_secs(30));

        assert_eq!(
            lease.complete(),
            Err(TaskLifecycleError::InvalidTransition {
                from: TaskLifecycleState::Queued,
                to: TaskLifecycleState::Completed,
            })
        );
    }

    #[test]
    fn cancel_transitions_are_supported_and_invalid_after_terminal_state() {
        let mut lease = DaemonTaskLease::new("task-5", "runtime-1", Duration::from_secs(30));

        assert_eq!(lease.cancel(), Ok(()));
        assert_eq!(lease.cancel(), Ok(()));

        assert_eq!(
            lease.start(),
            Err(TaskLifecycleError::InvalidTransition {
                from: TaskLifecycleState::Cancelled,
                to: TaskLifecycleState::Running,
            })
        );
    }

    #[test]
    fn cancel_is_supported_from_claimed_and_running_states() {
        let mut claimed = DaemonTaskLease::new("task-5b", "runtime-1", Duration::from_secs(30));
        claimed
            .claim("runtime-1")
            .expect("claim should succeed before cancel");
        assert_eq!(claimed.cancel(), Ok(()));
        assert_eq!(claimed.state, TaskLifecycleState::Cancelled);

        let mut running = DaemonTaskLease::new("task-5c", "runtime-1", Duration::from_secs(30));
        running
            .claim("runtime-1")
            .expect("claim should succeed before start");
        running.start().expect("start should succeed before cancel");
        assert_eq!(running.cancel(), Ok(()));
        assert_eq!(running.state, TaskLifecycleState::Cancelled);
    }

    #[test]
    fn cancel_rejects_terminal_completed_and_failed_states() {
        let mut completed = DaemonTaskLease::new("task-5d", "runtime-1", Duration::from_secs(30));
        completed
            .claim("runtime-1")
            .expect("claim should succeed before complete");
        completed
            .start()
            .expect("start should succeed before complete");
        completed
            .complete()
            .expect("complete should succeed before cancel attempt");
        assert_eq!(
            completed.cancel(),
            Err(TaskLifecycleError::InvalidTransition {
                from: TaskLifecycleState::Completed,
                to: TaskLifecycleState::Cancelled,
            })
        );

        let mut failed = DaemonTaskLease::new("task-5e", "runtime-1", Duration::from_secs(30));
        failed
            .claim("runtime-1")
            .expect("claim should succeed before fail");
        failed.start().expect("start should succeed before fail");
        failed
            .fail()
            .expect("fail should succeed before cancel attempt");
        assert_eq!(
            failed.cancel(),
            Err(TaskLifecycleError::InvalidTransition {
                from: TaskLifecycleState::Failed,
                to: TaskLifecycleState::Cancelled,
            })
        );
    }

    #[test]
    fn stale_heartbeat_detection_uses_ttl() {
        let mut lease = DaemonTaskLease::new("task-6", "runtime-1", Duration::from_secs(10));

        lease.claim("runtime-1").expect("claim should succeed");
        lease.heartbeat("runtime-1")
            .expect("heartbeat should succeed when claimed");

        lease.elapse(Duration::from_secs(9));
        assert!(!lease.is_stale());

        lease.elapse(Duration::from_secs(2));
        assert!(lease.is_stale());
    }

    #[test]
    fn heartbeat_rejects_wrong_owner() {
        let mut lease = DaemonTaskLease::new("task-7", "runtime-a", Duration::from_secs(10));
        lease.claim("runtime-a").expect("claim should succeed");

        assert_eq!(
            lease.heartbeat("runtime-b"),
            Err(TaskLifecycleError::LeaseOwnerMismatch)
        );
    }
}
