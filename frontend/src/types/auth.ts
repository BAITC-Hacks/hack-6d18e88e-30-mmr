export type AccountRole = 'student' | 'business' | 'admin';

export interface Account {
  id: number;
  email: string;
  full_name: string;
  role: AccountRole;
  email_verified: boolean;
  newsletter_opt_in: boolean;
}

export interface Registration {
  email: string;
  password: string;
  full_name: string;
  role: Exclude<AccountRole, 'admin'>;
  newsletter_opt_in?: boolean;
}

export interface AuthMessage { message: string }
