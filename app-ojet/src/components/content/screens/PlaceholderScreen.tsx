import { h } from "preact";

type Props = {
  heading: string;
  detail: string;
};

export function PlaceholderScreen({ heading, detail }: Props) {
  return (
    <div class="tb-screen-grid">
      <section class="tb-panel">
        <header class="tb-panel-header">
          <div>
            <h3>{heading}</h3>
            <p>{detail}</p>
          </div>
          <span class="tb-chip">Migration in Progress</span>
        </header>
        <div class="tb-summary">
          This OJET workspace is now active and ready for incremental screen migration. The current
          slice keeps behavior stable while each screen is ported with OJET-native component
          patterns.
        </div>
      </section>
    </div>
  );
}

