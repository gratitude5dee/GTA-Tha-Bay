# @dv/identity

Client-only identity adapters (imports only `@dv/shared`; no `services/**` file may import it). M04b3 ships `LocalIdentity`, the P0 identity that
needs no account: a UUIDv7 profile id minted on the device, a non-extractable ECDSA P-256 device key in IndexedDB `dv-identity` (store `identity`,
key `current`), its RFC 7638 thumbprint, `attestAge`, and `authHeader()`, which obtains a 24 h play token from route 5 through `PlayTokenClient`.

- `authHeader()` is `null` unless the age bracket is `18p` (and the boot config, when known, says `region: 'ok'`); any failure returns `null` and blocks retries for 60 s. Callers treat `null` as "use the offline path".
- The profile id, thumbprint and token never go into telemetry.
- `register`, `link`, `unlink` and `signInOnNewDevice` reject with `not_available` until M12a1, M13c1 and M14a add the other adapters behind `IdentityService`.
