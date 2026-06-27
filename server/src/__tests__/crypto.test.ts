import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from '../crypto.js'

const KEY = 'a'.repeat(64) // 32 bytes as hex

describe('crypto', () => {
  it('roundtrips plaintext through encrypt/decrypt', () => {
    const original = 'super-secret-token-value'
    const ciphertext = encrypt(original, KEY)
    expect(ciphertext).not.toBe(original)
    expect(decrypt(ciphertext, KEY)).toBe(original)
  })

  it('produces different ciphertext each call (random IV)', () => {
    const a = encrypt('same-input', KEY)
    const b = encrypt('same-input', KEY)
    expect(a).not.toBe(b)
  })

  it('throws if ciphertext is tampered', () => {
    const ct = encrypt('value', KEY)
    const tampered = ct.slice(0, -4) + 'XXXX'
    expect(() => decrypt(tampered, KEY)).toThrow()
  })
})
