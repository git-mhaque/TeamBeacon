import type { LucideIcon } from "lucide-react";

type Props = {
  description: string;
  icon: LucideIcon;
  id: string;
  title: string;
};

export function ConstructionScreen({ description, icon: Icon, id, title }: Props) {
  return (
    <section className="tb-construction-state" aria-label={`${title} under construction`}>
      <span className="tb-construction-symbol" role="img" aria-label="Under construction">
        <Icon aria-hidden="true" strokeWidth={1.7} />
      </span>
      <div className="tb-construction-copy">
        <p className="tb-eyebrow">TeamBeacon workspace</p>
        <p className="tb-construction-title" id={`${id}-title`}>
          {title}
        </p>
        <p>{description}</p>
      </div>
    </section>
  );
}
