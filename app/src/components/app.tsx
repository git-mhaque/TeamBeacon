import { Content } from "./content/index";

type Props = Readonly<{
  appName?: string;
}>;

export function App({ appName = "TeamBeacon" }: Props) {
  return <Content appName={appName} />;
}
