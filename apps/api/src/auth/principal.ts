import { ROLES, type Role } from '@cv/shared';

export { ROLES, type Role };

/**
 * The authenticated caller. `userId` is the named principal recorded on every write (IAM-05).
 * `roles` come from database grants only — an IdP claim can never confer an application role.
 */
export interface Principal {
  userId: string;
  subject: string;
  issuer: string;
  actorType: 'human' | 'service';
  roles: Role[];
  email?: string | null;
  displayName?: string | null;
  /** Local accounts only: the user must set their own password before anything else is allowed. */
  mustChangePassword?: boolean;
}

/** What the token itself proves, before we look the user up. */
export interface TokenIdentity {
  subject: string;
  issuer: string;
  actorType: 'human' | 'service';
  /** Local accounts: the `sv` claim; a password change bumps the stored version and ends older sessions. */
  sessionVersion?: number;
}

export const REQUEST_PRINCIPAL = 'principal';
