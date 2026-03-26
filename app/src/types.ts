export type ScreenId =
  | "integrations"
  | "initiatives"
  | "team"
  | "individuals"
  | "sprint"
  | "security"
  | "incidents"
  | "releases"
  | "executive";

export type NavItem = {
  id: ScreenId;
  label: string;
  blurb: string;
};
