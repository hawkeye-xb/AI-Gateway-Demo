import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { IAuthProvider } from '../../domain/IAuthProvider';
import { AuthError } from '../../domain/IAuthProvider';
import type { Identity } from '../../domain/types';

export class SupabaseJwtAuthProvider implements IAuthProvider {
  private jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(jwksUrl: string) {
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
  }

  async verify(token: string): Promise<Identity> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: undefined, // Supabase JWTs may not have iss
        audience: undefined,
      });
      if (!payload.sub) throw new AuthError('token missing sub');
      const meta = (payload.user_metadata || {}) as Record<string, unknown>;
      return {
        userId: payload.sub,
        tier: (meta.tier as string) || 'free',
        raw: payload as Record<string, unknown>,
      };
    } catch (e) {
      if (e instanceof AuthError) throw e;
      throw new AuthError(`invalid token: ${(e as Error).message}`);
    }
  }
}
