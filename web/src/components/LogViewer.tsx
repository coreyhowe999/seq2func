"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import type { LogEntry } from "@/lib/types";

interface LogViewerProps {
  runId: string;
  isActive: boolean; // Whether the pipeline is still running
}

const LEVEL_COLORS: Record<string, string> = {
  info: "text-gray-300",
  warn: "text-yellow-400",
  error: "text-red-400",
  debug: "text-gray-500",
};

const LEVEL_BADGES: Record<string, string> = {
  info: "bg-gray-700 text-gray-300",
  warn: "bg-yellow-900/50 text-yellow-400",
  error: "bg-red-900/50 text-red-400",
  debug: "bg-gray-800 text-gray-500",
};

export default function LogViewer({ runId, isActive }: LogViewerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [isExpanded, setIsExpanded] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastTimestampRef = useRef<string>("");

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter !== "all") params.set("level", filter);
      if (search) params.set("search", search);
      if (lastTimestampRef.current && isActive) {
        params.set("after", lastTimestampRef.current);
      }

      const url = `/api/pipeline/logs/${runId}${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) return;

      const data = (await res.json()) as { logs?: LogEntry[] };
      const newLogs: LogEntry[] = data.logs || [];

      if (lastTimestampRef.current && isActive && newLogs.length > 0) {
        // Append new logs (polling mode)
        setLogs((prev) => [...prev, ...newLogs]);
      } else {
        // Full refresh
        setLogs(newLogs);
      }

      if (newLogs.length > 0) {
        lastTimestampRef.current = newLogs[newLogs.length - 1].timestamp;
      }
    } catch {
      // Silently fail — logs are informational
    }
  }, [runId, filter, search, isActive]);

  // Initial fetch
  useEffect(() => {
    lastTimestampRef.current = "";
    fetchLogs();
  }, [filter, search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Poll for new logs while pipeline is active
  useEffect(() => {
    if (!isActive) return;
    const interval = setInterval(fetchLogs, 3000);
    return () => clearInterval(interval);
  }, [isActive, fetchLogs]);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Detect manual scroll (disable auto-scroll if user scrolls up)
  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 50;
    setAutoScroll(atBottom);
  };

  const errorCount = logs.filter((l) => l.level === "error").length;
  const warnCount = logs.filter((l) => l.level === "warn").length;

  return (
    <div className="card">
      {/* Header */}
      <div
        className="flex items-center justify-between cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-3">
          <svg
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
              isExpanded ? "rotate-90" : ""
            }`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <h2 className="text-lg font-semibold text-gray-200">Pipeline Logs</h2>
          {isActive && (
            <span className="flex items-center gap-1.5 text-xs text-teal-400">
              <span className="w-2 h-2 bg-teal-400 rounded-full animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-gray-500">{logs.length} lines</span>
          {errorCount > 0 && (
            <span className="bg-red-900/50 text-red-400 px-2 py-0.5 rounded-full">
              {errorCount} error{errorCount > 1 ? "s" : ""}
            </span>
          )}
          {warnCount > 0 && (
            <span className="bg-yellow-900/50 text-yellow-400 px-2 py-0.5 rounded-full">
              {warnCount} warning{warnCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="mt-4 space-y-3">
          {/* Controls */}
          <div className="flex items-center gap-3">
            <select
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                lastTimestampRef.current = "";
              }}
              className="bg-navy-900 border border-navy-600 rounded px-2 py-1 text-sm text-gray-300 focus:outline-none focus:ring-1 focus:ring-teal-500"
            >
              <option value="all">All Levels</option>
              <option value="errors">Errors Only</option>
              <option value="warnings">Warnings + Errors</option>
              <option value="info">Info</option>
              <option value="debug">Debug</option>
            </select>

            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                lastTimestampRef.current = "";
              }}
              placeholder="Search logs..."
              className="bg-navy-900 border border-navy-600 rounded px-3 py-1 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-teal-500 flex-1 max-w-xs"
            />

            {!autoScroll && (
              <button
                onClick={() => {
                  setAutoScroll(true);
                  if (containerRef.current) {
                    containerRef.current.scrollTop = containerRef.current.scrollHeight;
                  }
                }}
                className="text-xs text-teal-400 hover:text-teal-300 transition-colors"
              >
                Scroll to bottom
              </button>
            )}
          </div>

          {/* Log output */}
          <div
            ref={containerRef}
            onScroll={handleScroll}
            className="bg-navy-950 border border-navy-700 rounded-lg p-3 font-mono text-xs leading-relaxed overflow-auto"
            style={{ maxHeight: "400px", minHeight: "150px" }}
          >
            {logs.length === 0 ? (
              <p className="text-gray-600 italic">
                {isActive ? "Waiting for logs..." : "No log entries found."}
              </p>
            ) : (
              logs.map((log, i) => (
                <div
                  key={log.id || i}
                  className={`flex gap-2 py-0.5 hover:bg-navy-900/50 ${
                    log.level === "error" ? "bg-red-950/20" : ""
                  }`}
                >
                  {/* Timestamp */}
                  <span className="text-gray-600 whitespace-nowrap flex-shrink-0">
                    {new Date(log.timestamp).toLocaleTimeString("en-US", {
                      hour12: false,
                      hour: "2-digit",
                      minute: "2-digit",
                      second: "2-digit",
                    })}
                  </span>

                  {/* Level badge */}
                  <span
                    className={`px-1 rounded text-[10px] uppercase font-bold flex-shrink-0 w-12 text-center ${
                      LEVEL_BADGES[log.level] || LEVEL_BADGES.info
                    }`}
                  >
                    {log.level}
                  </span>

                  {/* Source */}
                  {log.source !== "nextflow" && (
                    <span className="text-teal-600 flex-shrink-0">
                      [{log.source.replace("step:", "")}]
                    </span>
                  )}

                  {/* Message */}
                  <span className={`${LEVEL_COLORS[log.level] || LEVEL_COLORS.info} break-all`}>
                    {log.message}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
