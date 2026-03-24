import { ReactNode } from "react";

type PanelProps = {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
};

export function Panel({ title, subtitle, action, children }: PanelProps) {
  return (
    <section className="panel">
      <header className="panel-header">
        <div>
          <h3>{title}</h3>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {action ? <div>{action}</div> : null}
      </header>
      {children}
    </section>
  );
}

