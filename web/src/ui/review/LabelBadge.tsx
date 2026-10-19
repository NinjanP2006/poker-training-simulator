import type { DecisionLabel } from "../../core/types";

const TEXT: Record<DecisionLabel, string> = { fine: "Fine", marginal: "Marginal", mistake: "Mistake" };
const ICON: Record<DecisionLabel, string> = { fine: "✓", marginal: "!", mistake: "✕" };

/** A decision grade as icon + word (never color alone), optionally with a count. */
export function LabelBadge({ label, count }: { label: DecisionLabel; count?: number }) {
  return (
    <span className={`label-badge ${label}`}>
      <span aria-hidden="true">{ICON[label]}</span> {count !== undefined ? `${count} ${TEXT[label].toLowerCase()}` : TEXT[label]}
    </span>
  );
}
