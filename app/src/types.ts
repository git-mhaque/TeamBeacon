export type ScreenId =
  | "integrations"
  | "initiatives"
  | "team"
  | "individuals"
  | "sprint"
  | "executive";

export type NavItem = {
  id: ScreenId;
  label: string;
  blurb: string;
};

