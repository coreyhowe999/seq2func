"use client";

interface StatusBadgeProps {
  status: string;
  size?: "sm" | "md";
}

const statusConfig: Record<string, { bg: string; text: string; icon: string; animate?: boolean }> = {
  pending: { bg: "bg-gray-700", text: "text-gray-300", icon: "\u23F3" },
  running: { bg: "bg-blue-900/50", text: "text-blue-300", icon: "\uD83D\uDD04", animate: true },
  completed: { bg: "bg-green-900/50", text: "text-green-300", icon: "\u2705" },
  failed: { bg: "bg-red-900/50", text: "text-red-300", icon: "\u274C" },
  skipped: { bg: "bg-yellow-900/50", text: "text-yellow-300", icon: "\u23ED\uFE0F" },
};

export default function StatusBadge({ status, size = "md" }: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.pending;
  const sizeClasses = size === "sm" ? "text-xs px-2 py-0.5" : "text-sm px-3 py-1";

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${config.bg} ${config.text} ${sizeClasses}`}
    >
      <span className={config.animate ? "animate-spin inline-block" : ""}>
        {config.icon}
      </span>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}
