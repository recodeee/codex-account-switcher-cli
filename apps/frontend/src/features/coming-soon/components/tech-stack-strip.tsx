import { useId, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type TechStackItem = {
  label: string;
  href: string;
  wordmark: ReactNode;
};

export function TechStackStrip({ className }: { className?: string }) {
  const loopedItems = [...TECH_STACK_ITEMS, ...TECH_STACK_ITEMS];

  return (
    <div className={cn("mt-4 space-y-2.5", className)}>
      <div className="text-[11px] font-semibold tracking-[0.24em] text-zinc-400 uppercase">
        TECH STACK
      </div>

      <div className="tech-stack-strip-fade-mask overflow-hidden">
        <div className="tech-stack-strip-marquee flex w-max items-center gap-2.5 sm:gap-3">
          {loopedItems.map((item, index) => (
            <a
              key={`${item.label}-${index}`}
              href={item.href}
              target="_blank"
              rel="noreferrer"
              aria-label={item.label}
              aria-hidden={index >= TECH_STACK_ITEMS.length}
              tabIndex={index >= TECH_STACK_ITEMS.length ? -1 : undefined}
              className="inline-flex h-11 shrink-0 items-center rounded-xl border border-white/15 bg-black/30 px-3.5 backdrop-blur-sm transition hover:bg-black/45"
            >
              {item.wordmark}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

const OnlookWordmark = () => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="139"
    height="17"
    viewBox="0 0 139 17"
    fill="none"
    aria-hidden="true"
    className="h-[14px] w-auto text-white"
  >
    <path
      d="M26.7578 16.502V4.40195H28.7485L43.3051 15.4019H44.7981V3.30195"
      stroke="currentColor"
      strokeWidth="2.73715"
    />
    <path
      d="M50.7734 3.30237V15.4023L67.0719 15.4023"
      stroke="currentColor"
      strokeWidth="2.73715"
    />
    <rect
      x="2"
      y="4.62305"
      width="19.4089"
      height="10.56"
      rx="5.27999"
      stroke="currentColor"
      strokeWidth="2.73715"
    />
    <rect
      x="69.6797"
      y="4.62305"
      width="19.4089"
      height="10.56"
      rx="5.27999"
      stroke="currentColor"
      strokeWidth="2.73715"
    />
    <rect
      x="94.0703"
      y="4.62305"
      width="19.4089"
      height="10.56"
      rx="5.27999"
      stroke="currentColor"
      strokeWidth="2.73715"
    />
    <path
      fillRule="evenodd"
      clipRule="evenodd"
      d="M120.823 10.3906V16.502H118.086V9.022V3.30204H120.823V7.65343H128.075L133.781 3.30213H138.295L130.657 9.126L138.583 16.502H134.565L127.999 10.3906H120.823ZM137.735 0.442137L137.66 0.34375L137.531 0.442137H137.735Z"
      fill="currentColor"
    />
  </svg>
);

const MedusaWordmark = () => (
  <span className="inline-flex items-center gap-1.5 text-white">
    <svg
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="h-[13px] w-[13px] fill-current"
    >
      <path d="M15.2447 2.92183L11.1688 0.576863C9.83524 -0.192288 8.20112 -0.192288 6.86753 0.576863L2.77285 2.92183C1.45804 3.69098 0.631592 5.11673 0.631592 6.63627V11.345C0.631592 12.8833 1.45804 14.2903 2.77285 15.0594L6.84875 17.4231C8.18234 18.1923 9.81646 18.1923 11.15 17.4231L15.2259 15.0594C16.5595 14.2903 17.3672 12.8833 17.3672 11.345V6.63627C17.4048 5.11673 16.5783 3.69098 15.2447 2.92183ZM9.00879 13.1834C6.69849 13.1834 4.82019 11.3075 4.82019 9C4.82019 6.69255 6.69849 4.81657 9.00879 4.81657C11.3191 4.81657 13.2162 6.69255 13.2162 9C13.2162 11.3075 11.3379 13.1834 9.00879 13.1834Z" />
    </svg>
    <span className="text-[15px] font-medium leading-none tracking-[-0.01em]">
      medusa
    </span>
  </span>
);

const ResendWordmark = () => (
  <span className="inline-flex items-center gap-1.5 text-white">
    <svg viewBox="0 0 1800 1800" aria-hidden="true" className="h-[12px] w-[12px] fill-current">
      <path d="M1000.46 450C1174.77 450 1278.43 553.669 1278.43 691.282C1278.43 828.896 1174.77 932.563 1000.46 932.563H912.382L1350 1350H1040.82L707.794 1033.48C683.944 1011.47 672.936 985.781 672.935 963.765C672.935 932.572 694.959 905.049 737.161 893.122L908.712 847.244C973.85 829.812 1018.81 779.353 1018.81 713.298C1018.8 632.567 952.745 585.78 871.095 585.78H450V450H1000.46Z" />
    </svg>
    <span className="text-[13px] font-semibold leading-none">resend</span>
  </span>
);

const SupabaseWordmark = () => {
  const gradientIdBase = useId().replace(/:/g, "");
  const gradientAId = `${gradientIdBase}-supabase-logo-gradient-a`;
  const gradientBId = `${gradientIdBase}-supabase-logo-gradient-b`;

  return (
    <span className="inline-flex items-center gap-1.5 text-white">
      <svg
        viewBox="0 0 109 113"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="h-[14px] w-auto"
      >
        <path
          d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z"
          fill={`url(#${gradientAId})`}
        />
        <path
          d="M63.7076 110.284C60.8481 113.885 55.0502 111.912 54.9813 107.314L53.9738 40.0627L99.1935 40.0627C107.384 40.0627 111.952 49.5228 106.859 55.9374L63.7076 110.284Z"
          fill={`url(#${gradientBId})`}
          fillOpacity="0.2"
        />
        <path
          d="M45.317 2.07103C48.1765 -1.53037 53.9745 0.442937 54.0434 5.041L54.4849 72.2922H9.83113C1.64038 72.2922 -2.92775 62.8321 2.1655 56.4175L45.317 2.07103Z"
          fill="#3ECF8E"
        />
        <defs>
          <linearGradient
            id={gradientAId}
            x1="53.9738"
            y1="54.974"
            x2="94.1635"
            y2="71.8295"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#249361" />
            <stop offset="1" stopColor="#3ECF8E" />
          </linearGradient>
          <linearGradient
            id={gradientBId}
            x1="36.1558"
            y1="30.578"
            x2="54.4844"
            y2="65.0806"
            gradientUnits="userSpaceOnUse"
          >
            <stop />
            <stop offset="1" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <span className="text-[13px] font-semibold leading-none">supabase</span>
    </span>
  );
};

const OpenAIWordmark = () => (
  <span className="inline-flex items-center gap-1.5 text-white">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 256 260"
      aria-hidden="true"
      className="h-[14px] w-auto fill-current"
    >
      <path d="M239.184 106.203a64.716 64.716 0 0 0-5.576-53.103C219.452 28.459 191 15.784 163.213 21.74A65.586 65.586 0 0 0 52.096 45.22a64.716 64.716 0 0 0-43.23 31.36c-14.31 24.602-11.061 55.634 8.033 76.74a64.665 64.665 0 0 0 5.525 53.102c14.174 24.65 42.644 37.324 70.446 31.36a64.72 64.72 0 0 0 48.754 21.744c28.481.025 53.714-18.361 62.414-45.481a64.767 64.767 0 0 0 43.229-31.36c14.137-24.558 10.875-55.423-8.083-76.483Zm-97.56 136.338a48.397 48.397 0 0 1-31.105-11.255l1.535-.87 51.67-29.825a8.595 8.595 0 0 0 4.247-7.367v-72.85l21.845 12.636c.218.111.37.32.409.563v60.367c-.056 26.818-21.783 48.545-48.601 48.601Zm-104.466-44.61a48.345 48.345 0 0 1-5.781-32.589l1.534.921 51.722 29.826a8.339 8.339 0 0 0 8.441 0l63.181-36.425v25.221a.87.87 0 0 1-.358.665l-52.335 30.184c-23.257 13.398-52.97 5.431-66.404-17.803ZM23.549 85.38a48.499 48.499 0 0 1 25.58-21.333v61.39a8.288 8.288 0 0 0 4.195 7.316l62.874 36.272-21.845 12.636a.819.819 0 0 1-.767 0L41.353 151.53c-23.211-13.454-31.171-43.144-17.804-66.405v.256Zm179.466 41.695-63.08-36.63L161.73 77.86a.819.819 0 0 1 .768 0l52.233 30.184a48.6 48.6 0 0 1-7.316 87.635v-61.391a8.544 8.544 0 0 0-4.4-7.213Zm21.742-32.69-1.535-.922-51.619-30.081a8.39 8.39 0 0 0-8.492 0L99.98 99.808V74.587a.716.716 0 0 1 .307-.665l52.233-30.133a48.652 48.652 0 0 1 72.236 50.391v.205ZM88.061 139.097l-21.845-12.585a.87.87 0 0 1-.41-.614V65.685a48.652 48.652 0 0 1 79.757-37.346l-1.535.87-51.67 29.825a8.595 8.595 0 0 0-4.246 7.367l-.051 72.697Zm11.868-25.58 28.138-16.217 28.188 16.218v32.434l-28.086 16.218-28.188-16.218-.052-32.434Z" />
    </svg>
    <span className="text-[13px] font-semibold leading-none">OpenAI</span>
  </span>
);

const VercelWordmark = () => (
  <span className="inline-flex items-center gap-1.5 text-white">
    <svg
      viewBox="0 0 256 222"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-[12px] w-[12px] fill-current"
    >
      <path d="m128 0 128 221.705H0z" />
    </svg>
    <span className="text-[13px] font-semibold leading-none">Vercel</span>
  </span>
);

const V0Wordmark = () => (
  <span className="inline-flex items-center gap-1.5 text-white">
    <svg
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-[14px] w-[14px] fill-current"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M9.50321 5.5H13.2532C13.3123 5.5 13.3704 5.5041 13.4273 5.51203L9.51242 9.42692C9.50424 9.36912 9.5 9.31006 9.5 9.25L9.5 5.5L8 5.5L8 9.25C8 10.7688 9.23122 12 10.75 12H14.5V10.5L10.75 10.5C10.6899 10.5 10.6309 10.4958 10.5731 10.4876L14.4904 6.57028C14.4988 6.62897 14.5032 6.68897 14.5032 6.75V10.5H16.0032V6.75C16.0032 5.23122 14.772 4 13.2532 4H9.50321V5.5ZM0 5V5.00405L5.12525 11.5307C5.74119 12.3151 7.00106 11.8795 7.00106 10.8822V5H5.50106V9.58056L1.90404 5H0Z"
      />
    </svg>
    <span className="text-[13px] font-semibold leading-none">v0</span>
  </span>
);

const ClaudeWordmark = () => (
  <span className="inline-flex items-center gap-1.5 text-white">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-[14px] w-[14px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2l2.8 5.7L21 8.6l-4.5 4.4L17.5 20 12 17l-5.5 3 1-7-4.5-4.4 6.2-.9L12 2Z" />
    </svg>
    <span className="text-[13px] font-semibold leading-none">Claude</span>
  </span>
);

const OpenRouterWordmark = () => {
  const clipPathId = `${useId().replace(/:/g, "")}-openrouter-logo-clip`;

  return (
    <span className="inline-flex items-center gap-1.5 text-white">
      <svg
        viewBox="0 0 512 512"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="h-[14px] w-auto fill-current stroke-current"
      >
        <g clipPath={`url(#${clipPathId})`}>
          <path
            d="M3 248.945C18 248.945 76 236 106 219C136 202 136 202 198 158C276.497 102.293 332 120.945 423 120.945"
            strokeWidth="90"
          />
          <path d="M511 121.5L357.25 210.268L357.25 32.7324L511 121.5Z" />
          <path
            d="M0 249C15 249 73 261.945 103 278.945C133 295.945 133 295.945 195 339.945C273.497 395.652 329 377 420 377"
            strokeWidth="90"
          />
          <path d="M508 376.445L354.25 287.678L354.25 465.213L508 376.445Z" />
        </g>
        <defs>
          <clipPath id={clipPathId}>
            <rect width="512" height="512" />
          </clipPath>
        </defs>
      </svg>
      <span className="text-[13px] font-semibold leading-none">OpenRouter</span>
    </span>
  );
};

const ProbotWordmark = () => (
  <span className="inline-flex items-center gap-1.5 text-white">
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-[14px] w-[14px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="6.5" y="8" width="11" height="9" rx="2.2" />
      <path d="M9.5 12.5h.01M14.5 12.5h.01" />
      <path d="M12 8V5.8" />
      <circle cx="12" cy="4.5" r="1.2" fill="currentColor" stroke="none" />
      <path d="M8.5 18.8h7" />
    </svg>
    <span className="text-[13px] font-semibold leading-none">Probot</span>
  </span>
);

const FreestyleWordmark = () => (
  <span className="inline-flex items-center gap-1.5 text-white">
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className="h-[14px] w-[14px]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 17.5a4.5 4.5 0 0 0-1.1-8.86A6.5 6.5 0 0 0 6.6 6.7 4.8 4.8 0 0 0 6 16.2h14" />
      <path d="M8 19v1.5" />
      <path d="M12 19v1.5" />
      <path d="M16 19v1.5" />
    </svg>
    <span className="text-[13px] font-semibold leading-none">Freestyle</span>
  </span>
);

const HostingerWordmark = () => (
  <span className="inline-flex items-center gap-1.5 text-white">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="h-[14px] w-[14px] fill-current"
    >
      <path d="M2 2h4.5v16H2zM7.5 7h4.5v11H7.5zM13 2h5v16h-5z" />
    </svg>
    <span className="text-[13px] font-semibold leading-none tracking-[0.14em] uppercase">
      Hostinger
    </span>
  </span>
);

const CoolifyWordmark = () => (
  <span className="inline-flex items-center gap-1.5 text-white">
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      aria-hidden="true"
      className="h-[14px] w-[14px]"
    >
      <path
        fill="#7C3AED"
        d="M16.5 2.5H8a5 5 0 0 0-5 5v5a5 5 0 0 0 5 5h8.5v-3.25H8.75A1.75 1.75 0 0 1 7 12.5v-5c0-.97.78-1.75 1.75-1.75h7.75V2.5Z"
      />
      <path fill="#A78BFA" d="M2 3h5.5v3H2z" />
    </svg>
    <span className="text-[13px] font-semibold leading-none">Coolify</span>
  </span>
);

const TECH_STACK_ITEMS: TechStackItem[] = [
  {
    label: "Onlook",
    href: "https://github.com/onlook-dev/onlook",
    wordmark: <OnlookWordmark />,
  },
  {
    label: "medusa",
    href: "https://medusajs.com",
    wordmark: <MedusaWordmark />,
  },
  {
    label: "resend",
    href: "https://resend.com",
    wordmark: <ResendWordmark />,
  },
  {
    label: "supabase",
    href: "https://supabase.com",
    wordmark: <SupabaseWordmark />,
  },
  {
    label: "OpenAI",
    href: "https://openai.com",
    wordmark: <OpenAIWordmark />,
  },
  {
    label: "Vercel",
    href: "https://vercel.com",
    wordmark: <VercelWordmark />,
  },
  {
    label: "v0",
    href: "https://v0.dev",
    wordmark: <V0Wordmark />,
  },
  {
    label: "Claude",
    href: "https://claude.ai",
    wordmark: <ClaudeWordmark />,
  },
  {
    label: "OpenRouter",
    href: "https://openrouter.ai",
    wordmark: <OpenRouterWordmark />,
  },
  {
    label: "Probot",
    href: "https://github.com/probot/probot",
    wordmark: <ProbotWordmark />,
  },
  {
    label: "Freestyle",
    href: "https://freestyle.sh",
    wordmark: <FreestyleWordmark />,
  },
  {
    label: "Hostinger",
    href: "https://www.hostinger.com",
    wordmark: <HostingerWordmark />,
  },
  {
    label: "Coolify",
    href: "https://coolify.io",
    wordmark: <CoolifyWordmark />,
  },
];
