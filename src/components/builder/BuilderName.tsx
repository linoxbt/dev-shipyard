import { Link } from "@tanstack/react-router";
import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { shortAddr } from "@/lib/explorer/format";
import { useQieName } from "@/hooks/useQieIdentity";

// A builder, shown the way people know them: by their .qie name when they hold
// one, by a short address when they do not. The name is only ever one the QIE
// ID contract says this wallet owns right now.

function hueFrom(address: string, offset: number) {
  const hex = address.toLowerCase().replace(/^0x/, "");
  const slice = parseInt(hex.slice(offset, offset + 6) || "0", 16);
  return slice % 360;
}

/** A deterministic avatar from the address: the same wallet always gets the
 *  same colours, on every page and for every viewer. */
export function Identicon({
  address,
  size = 32,
  className,
}: {
  address: string;
  size?: number;
  className?: string;
}) {
  const a = hueFrom(address, 2);
  const b = hueFrom(address, 10);
  const c = hueFrom(address, 20);
  return (
    <span
      aria-hidden
      className={cn("inline-block shrink-0 rounded-full ring-1 ring-border", className)}
      style={{
        width: size,
        height: size,
        background: `conic-gradient(from ${a}deg, hsl(${a} 70% 55%), hsl(${b} 70% 50%), hsl(${c} 65% 45%), hsl(${a} 70% 55%))`,
      }}
    />
  );
}

export function BuilderName({
  address,
  link = true,
  avatar = false,
  className,
}: {
  address: string;
  link?: boolean;
  avatar?: boolean;
  className?: string;
}) {
  const name = useQieName(address);
  const content = (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)} title={address}>
      {avatar && <Identicon address={address} size={16} />}
      {name ? (
        <>
          <span className="truncate">{name.full}</span>
          <BadgeCheck className="h-3 w-3 shrink-0 text-info" aria-label="QIE ID" />
        </>
      ) : (
        <span className="truncate">{shortAddr(address)}</span>
      )}
    </span>
  );
  if (!link) return content;
  return (
    <Link to="/dev/$address" params={{ address }} className="min-w-0 hover:text-primary">
      {content}
    </Link>
  );
}
