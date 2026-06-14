// The exporter profile's fields, shared by the operator Settings form and the
// customer self-onboarding form so the two can never drift apart.

export type ExporterProfileInput = {
  legal_name: string;
  address: string;
  factory_address: string;
  cin: string;
  gstin: string;
  iec: string;
  organic_code: string;
  bank_name: string;
  bank_branch: string;
  bank_swift: string;
  bank_account: string;
  bank_beneficiary: string;
  declaration_lut: string;
  declaration_rodtep: string;
  declaration_origin: string;
  default_currency: string;
  default_incoterm: string;
};

// A customs broker (CHA). An exporter can have several — e.g. a different broker
// per port — so these live in their own list, not as flat profile fields. One
// row is marked default for automatic document sends.
export type ChaContactInput = {
  name: string;
  email: string;
  port: string;
  is_default: boolean;
};

export type ProfileField = {
  key: keyof ExporterProfileInput;
  label: string;
  placeholder?: string;
  area?: boolean;
};

export const IDENTITY_FIELDS: ProfileField[] = [
  { key: "legal_name", label: "Legal name", placeholder: "Your company's registered name" },
  { key: "address", label: "Registered address", placeholder: "Full address", area: true },
  { key: "factory_address", label: "Factory address", placeholder: "Factory / plant address", area: true },
  { key: "iec", label: "IEC (Import Export Code)", placeholder: "10 digits" },
  { key: "gstin", label: "GSTIN", placeholder: "15 characters" },
  { key: "cin", label: "CIN", placeholder: "Company ID number" },
  { key: "organic_code", label: "Organic code", placeholder: "e.g. IN-BIO-132 (if any)" },
  { key: "default_currency", label: "Default currency", placeholder: "USD" },
  { key: "default_incoterm", label: "Default incoterm", placeholder: "FOB" },
];

export const BANK_FIELDS: ProfileField[] = [
  { key: "bank_name", label: "Bank name", placeholder: "e.g. HDFC Bank" },
  { key: "bank_branch", label: "Branch", placeholder: "Branch / city" },
  { key: "bank_swift", label: "SWIFT code", placeholder: "e.g. HDFCINBB" },
  { key: "bank_account", label: "Account / IBAN", placeholder: "Account number" },
  { key: "bank_beneficiary", label: "Beneficiary name", placeholder: "Account holder name" },
];

export const DECLARATION_FIELDS: ProfileField[] = [
  {
    key: "declaration_lut",
    label: "LUT declaration (export without IGST)",
    placeholder: "Your exact LUT wording incl. ARN and date",
    area: true,
  },
  {
    key: "declaration_rodtep",
    label: "RoDTEP declaration",
    placeholder: "RoDTEP claim wording",
    area: true,
  },
  {
    key: "declaration_origin",
    label: "Statement on Origin (EU GSP / REX)",
    placeholder: "Statement of origin incl. your REX number (if you export to the EU)",
    area: true,
  },
];

export const ALL_PROFILE_FIELDS: ProfileField[] = [
  ...IDENTITY_FIELDS,
  ...BANK_FIELDS,
  ...DECLARATION_FIELDS,
];
