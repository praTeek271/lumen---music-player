"use client";
// components/FirstLaunch.tsx
//
// Shown on first launch (or when queue is empty and no folders are saved).
// Asks the user to grant access to their Music folder once.
// The FileSystemDirectoryHandle is stored in IDB — subsequent sessions
// silently reuse it without asking again (browser may show a one-line banner).

import { useState } from "react";
import {
  FolderOpen,
  Music,
  Smartphone,
  HardDrive,
  ChevronRight,
  X,
} from "lucide-react";
import { useMusicFolders } from "@/hooks/useMusicFolders";
import { VinylSVG } from "./VinylSVG";

interface FirstLaunchProps {
  onDismiss: () => void; // skip — go straight to manual file picking
  onPickFiles: () => void; // open native file picker
}

export function FirstLaunch({ onDismiss, onPickFiles }: FirstLaunchProps) {
  const { grantFolder, hasSupport } = useMusicFolders();
  const [granting, setGranting] = useState(false);
  const [step, setStep] = useState<"intro" | "done">("intro");

  const handleGrant = async () => {
    setGranting(true);
    try {
      await grantFolder();
      setStep("done");
    } finally {
      setGranting(false);
    }
  };

  if (step === "done") {
    return (
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 500,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.92)",
          backdropFilter: "blur(20px)",
          padding: 24,
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 320 }}>
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: "50%",
              margin: "0 auto 20px",
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Music size={32} style={{ color: "rgba(255,255,255,0.80)" }} />
          </div>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 22,
              fontWeight: 700,
              color: "rgba(255,255,255,0.90)",
              margin: "0 0 10px",
            }}
          >
            Access Granted
          </h2>
          <p
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.45)",
              lineHeight: 1.6,
              margin: "0 0 28px",
            }}
          >
            LUMEN will remember this folder. Next time you open the app, your
            music loads automatically — no re-picking needed.
          </p>
          <button
            onClick={onDismiss}
            style={{
              width: "100%",
              padding: "12px 0",
              borderRadius: 12,
              cursor: "pointer",
              background: "rgba(255,255,255,0.10)",
              border: "1px solid rgba(255,255,255,0.18)",
              color: "rgba(255,255,255,0.85)",
              fontSize: 14,
              fontWeight: 600,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "rgba(255,255,255,0.16)")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.background = "rgba(255,255,255,0.10)")
            }
          >
            Start Listening
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 500,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.95)",
        backdropFilter: "blur(20px)",
        padding: 24,
      }}
    >
      {/* Skip button */}
      <button
        onClick={onDismiss}
        style={{
          position: "absolute",
          top: 20,
          right: 20,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "rgba(255,255,255,0.30)",
          padding: 8,
          borderRadius: 8,
          display: "flex",
          alignItems: "center",
          gap: 4,
          fontSize: 12,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.color = "rgba(255,255,255,0.60)")
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.color = "rgba(255,255,255,0.30)")
        }
      >
        <X size={14} /> Skip
      </button>

      <div style={{ maxWidth: 340, width: "100%" }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <VinylSVG size={80} className="mx-auto" />
          <h1
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 26,
              fontWeight: 700,
              color: "rgba(255,255,255,0.92)",
              margin: "16px 0 6px",
              letterSpacing: "-0.02em",
            }}
          >
            Welcome to LUMEN
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "rgba(255,255,255,0.40)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Open Music Player — your offline music, your device
          </p>
        </div>

        {/* Permission explanation */}
        <div
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 16,
            padding: 20,
            marginBottom: 20,
          }}
        >
          <p
            style={{
              fontSize: 12,
              color: "rgba(255,255,255,0.40)",
              margin: "0 0 14px",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            How it works
          </p>
          {[
            {
              icon: <FolderOpen size={16} />,
              text: "Grant access to your Music folder once",
            },
            {
              icon: <HardDrive size={16} />,
              text: "LUMEN remembers it — no re-picking next session",
            },
            {
              icon: <Smartphone size={16} />,
              text: "Works fully offline, nothing is uploaded",
            },
          ].map(({ icon, text }, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                marginBottom: i < 2 ? 12 : 0,
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: "rgba(255,255,255,0.06)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "rgba(255,255,255,0.50)",
                }}
              >
                {icon}
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: 13,
                  color: "rgba(255,255,255,0.65)",
                  lineHeight: 1.4,
                }}
              >
                {text}
              </p>
            </div>
          ))}
        </div>

        {/* Primary CTA — folder access */}
        {hasSupport && (
          <button
            onClick={handleGrant}
            disabled={granting}
            style={{
              width: "100%",
              padding: "13px 0",
              borderRadius: 12,
              cursor: granting ? "wait" : "pointer",
              background: granting
                ? "rgba(255,255,255,0.08)"
                : "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.20)",
              color: "rgba(255,255,255,0.90)",
              fontSize: 14,
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              marginBottom: 10,
              transition: "background 0.15s",
            }}
            onMouseEnter={(e) => {
              if (!granting)
                e.currentTarget.style.background = "rgba(255,255,255,0.18)";
            }}
            onMouseLeave={(e) => {
              if (!granting)
                e.currentTarget.style.background = "rgba(255,255,255,0.12)";
            }}
          >
            <FolderOpen size={16} />
            {granting ? "Waiting for permission…" : "Grant Music Folder Access"}
            {!granting && <ChevronRight size={14} style={{ opacity: 0.6 }} />}
          </button>
        )}

        {/* Secondary CTA — just pick files */}
        <button
          onClick={() => {
            onPickFiles();
            onDismiss();
          }}
          style={{
            width: "100%",
            padding: "11px 0",
            borderRadius: 12,
            cursor: "pointer",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.08)",
            color: "rgba(255,255,255,0.45)",
            fontSize: 13,
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            transition: "border-color 0.15s, color 0.15s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)";
            e.currentTarget.style.color = "rgba(255,255,255,0.65)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)";
            e.currentTarget.style.color = "rgba(255,255,255,0.45)";
          }}
        >
          <Music size={14} />
          Pick Files Instead
        </button>

        {/* Platform note */}
        {!hasSupport && (
          <p
            style={{
              fontSize: 11,
              color: "rgba(255,255,255,0.25)",
              textAlign: "center",
              marginTop: 14,
              lineHeight: 1.5,
            }}
          >
            Folder access requires Chrome or Edge. Use Pick Files to add music
            on this browser.
          </p>
        )}
      </div>
    </div>
  );
}
