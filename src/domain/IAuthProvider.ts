import type { Identity } from './types';

export class AuthError extends Error {
  constructor(message: string) { super(message); this.name = 'AuthError'; }
}

export interface IAuthProvider {
  verify(token: string): Promise<Identity>;
}
