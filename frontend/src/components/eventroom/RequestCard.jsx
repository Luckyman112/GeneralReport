import { KINDS, STATUS_INFO, kindOf, statusOf } from "./requestModel";

export function StatusChip({ ev }) {
  const st = statusOf(ev);
  const info = STATUS_INFO[st] || { label: ev.status, tone: "pending" };
  return <span className={`request-status tone-${info.tone}`}>{info.label}</span>;
}

export function KindBadge({ ev }) {
  const k = kindOf(ev);
  return <span className={`request-kind-badge kind-${k}`}>{KINDS[k].short}</span>;
}
