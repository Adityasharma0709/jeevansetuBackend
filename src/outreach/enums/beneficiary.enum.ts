export enum BeneficiaryType {
  PRIORITY = 'Priority',
  STAKEHOLDER = 'Stakeholder',
  GENERAL = 'General',
}

export enum Gender {
  MALE = 'Male',
  FEMALE = 'Female',
  OTHER = 'Other',
}

export enum MaritalStatus {
  SINGLE = 'Single',
  MARRIED = 'Married',
  WIDOWED = 'Widowed',
  DIVORCED = 'Divorced',
}

export enum EconomicStatus {
  AAY = 'AAY',
  PHH = 'PHH',
  Others='Others'
}

export enum EmploymentStatus {
  WORKING = 'Working',
  NOT_WORKING = 'Not-Working',
  DAILY_WAGE_EARNER = 'Daily-Wage-Earner',
  SELF_EMPLOYED = 'Self-Employed',
}

// These fields allow "Other" to be replaced by custom free-text from the user
// so they shouldn't be strictly validated by @IsEnum in the DTO, but defined here for reference.
export enum Qualification {
  NO_FORMAL_EDUCATION = 'No Formal Education',
  PRIMARY = 'Primary (Class 1–5)',
  UPPER_PRIMARY = 'Upper Primary (Class 6–8)',
  SECONDARY = 'Secondary (Class 9–10)',
  SENIOR_SECONDARY = 'Senior Secondary (Class 11–12)',
  DIPLOMA = 'Diploma / ITI',
  GRADUATE = 'Graduate',
  POST_GRADUATE = 'Post Graduate',
  OTHER = 'Other',
}

export enum Religion {
  HINDU = 'Hindu',
  MUSLIM = 'Muslim',
  CHRISTIAN = 'Christian',
  SIKH = 'Sikh',
  BUDDHIST = 'Buddhist',
  JAIN = 'Jain',
  OTHER = 'Other',
}

export enum Caste {
  GENERAL = 'General',
  OBC = 'OBC',
  SC = 'SC',
  ST = 'ST',
  OTHER = 'Other',
}

export enum PrimaryIncomeSource {
  AGRICULTURE = 'Agriculture',
  DAILY_LABOUR = 'Daily Labour',
  SMALL_BUSINESS = 'Small Business',
  GOVERNMENT_SERVICE = 'Government Service',
  PRIVATE_SERVICE = 'Private Service',
  PENSION_REMITTANCE = 'Pension / Remittance',
  OTHER = 'Other',
}
