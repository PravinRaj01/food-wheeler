"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { LogIn, LogOut, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DockItem {
  name: string;
  href: string;
  icon: LucideIcon;
}

// (hover: hover) and (pointer: fine) never changes mid-session on a given
// device, so there's nothing to subscribe to - same useSyncExternalStore
// "browser-only value, no server equivalent" pattern as lib/hooks/use-platform.ts.
function subscribeNoop() {
  return () => {};
}
function getFinePointerSnapshot() {
  return window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}
function getFinePointerServerSnapshot() {
  return false;
}

/** The floating macOS-style dock - the only navigation chrome below the
 * header, at every breakpoint (it replaces the old desktop sidebar and the
 * old edge-to-edge mobile tab bar). `primaryItems` and `secondaryItems` are
 * rendered as two groups split by a divider, with the account key (Log
 * in/Logout) always last. */
export function Dock({
  primaryItems,
  secondaryItems,
  pathname,
  signedIn,
  onLogout,
}: {
  primaryItems: DockItem[];
  secondaryItems: DockItem[];
  pathname: string;
  signedIn: boolean;
  onLogout: () => void;
}) {
  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");
  const finePointer = useSyncExternalStore(subscribeNoop, getFinePointerSnapshot, getFinePointerServerSnapshot);
  const reducedMotion = useReducedMotion();
  const magnetEnabled = finePointer && !reducedMotion;

  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  let nextIndex = 0;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 z-40 mx-auto flex w-fit items-center gap-3 rounded-[1.75rem] border border-white/40 bg-[var(--dock-bg)] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_20px_50px_-15px_rgba(0,0,0,0.5)] backdrop-blur-2xl backdrop-saturate-150"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
      onMouseLeave={() => setHoveredIndex(null)}
    >
      {primaryItems.map((item) => {
        const index = nextIndex++;
        return (
          <DockKey
            key={item.href}
            index={index}
            hoveredIndex={hoveredIndex}
            onHover={setHoveredIndex}
            magnetEnabled={magnetEnabled}
            icon={item.icon}
            label={item.name}
            active={isActive(item.href)}
            href={item.href}
          />
        );
      })}
      <div aria-hidden className="mx-2 h-7 w-px shrink-0 self-center bg-line md:h-8" />
      {secondaryItems.map((item) => {
        const index = nextIndex++;
        return (
          <DockKey
            key={item.href}
            index={index}
            hoveredIndex={hoveredIndex}
            onHover={setHoveredIndex}
            magnetEnabled={magnetEnabled}
            icon={item.icon}
            label={item.name}
            active={isActive(item.href)}
            href={item.href}
          />
        );
      })}
      {signedIn ? (
        <DockKey
          index={nextIndex}
          hoveredIndex={hoveredIndex}
          onHover={setHoveredIndex}
          magnetEnabled={magnetEnabled}
          icon={LogOut}
          label="Logout"
          active={false}
          onClick={onLogout}
        />
      ) : (
        <DockKey
          index={nextIndex}
          hoveredIndex={hoveredIndex}
          onHover={setHoveredIndex}
          magnetEnabled={magnetEnabled}
          icon={LogIn}
          label="Log in"
          active={isActive("/login")}
          href="/login"
        />
      )}
    </nav>
  );
}

function DockKey({
  index,
  hoveredIndex,
  onHover,
  magnetEnabled,
  icon: Icon,
  label,
  active,
  href,
  onClick,
}: {
  index: number;
  hoveredIndex: number | null;
  onHover: (index: number | null) => void;
  magnetEnabled: boolean;
  icon: LucideIcon;
  label: string;
  active: boolean;
  href?: string;
  onClick?: () => void;
}) {
  const distance = hoveredIndex === null ? Infinity : Math.abs(index - hoveredIndex);
  const lift = magnetEnabled ? (distance === 0 ? -8 : distance === 1 ? -3 : 0) : 0;
  const scale = magnetEnabled ? (distance === 0 ? 1.2 : distance === 1 ? 1.08 : 1) : 1;

  const key = (
    <motion.div
      animate={{ y: lift, scale }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className={cn(
        "flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--dock-key)] shadow-[inset_0_1px_0_rgba(255,255,255,0.5),0_1px_2px_rgba(0,0,0,0.15)] md:h-13 md:w-13",
        active && "ring-2 ring-ember/70",
      )}
    >
      <Icon className={cn("h-5 w-5", active ? "text-ember" : "text-canvas-fg/70")} />
    </motion.div>
  );

  const wrapperProps = {
    "aria-label": label,
    onMouseEnter: () => onHover(index),
    onFocus: () => onHover(index),
    onBlur: () => onHover(null),
    className: "relative flex flex-col items-center rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ember/50",
  };

  return (
    // "group" lives HERE, on the ancestor of both the key and the tooltip -
    // it previously sat on the Link/button, a SIBLING of the tooltip span
    // below rather than an ancestor, so group-hover/group-focus-visible on
    // the tooltip never matched and it never appeared.
    <div className="group relative flex flex-col items-center">
      {href ? (
        <Link href={href} {...wrapperProps}>
          {key}
        </Link>
      ) : (
        <button type="button" onClick={onClick} {...wrapperProps}>
          {key}
        </button>
      )}
      {/* Always reserves the same 1px dot's worth of height, active or not,
          so every key's icon stays vertically aligned in the row - only the
          active one is actually visible, and its layoutId is what makes it
          slide between keys on navigation instead of popping. */}
      {active ? (
        <motion.span layoutId="dock-active-dot" className="mt-1 h-1 w-1 rounded-full bg-ember" />
      ) : (
        <span aria-hidden className="mt-1 h-1 w-1" />
      )}
      <span
        role="tooltip"
        className="pointer-events-none absolute -top-12 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-canvas px-2 py-1 text-[11px] text-canvas-fg opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
      >
        {label}
      </span>
    </div>
  );
}
