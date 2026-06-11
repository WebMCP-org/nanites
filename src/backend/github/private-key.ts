const PKCS1_PEM_HEADER = "-----BEGIN RSA PRIVATE KEY-----";
const PKCS1_PEM_FOOTER = "-----END RSA PRIVATE KEY-----";
const PKCS8_PEM_HEADER = "-----BEGIN PRIVATE KEY-----";
const PKCS8_PEM_FOOTER = "-----END PRIVATE KEY-----";
const PEM_LINE_LENGTH = 64;

// AlgorithmIdentifier for rsaEncryption (OID 1.2.840.113549.1.1.1, NULL params).
const RSA_ALGORITHM_IDENTIFIER_DER = [
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
];
const DER_VERSION_ZERO = [0x02, 0x01, 0x00];
const DER_SEQUENCE_TAG = 0x30;
const DER_OCTET_STRING_TAG = 0x04;

function encodeDerLength(length: number): number[] {
  if (length < 0x80) {
    return [length];
  }

  const bytes: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    bytes.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return [0x80 | bytes.length, ...bytes];
}

function wrapDer(tag: number, content: readonly number[]): number[] {
  return [tag, ...encodeDerLength(content.length), ...content];
}

function readPkcs1DerBytes(pem: string): number[] | null {
  const headerIndex = pem.indexOf(PKCS1_PEM_HEADER);
  const footerIndex = pem.indexOf(PKCS1_PEM_FOOTER);
  if (headerIndex === -1 || footerIndex === -1 || footerIndex <= headerIndex) {
    return null;
  }

  const base64Body = pem
    .slice(headerIndex + PKCS1_PEM_HEADER.length, footerIndex)
    .replace(/\s+/g, "");
  try {
    const binary = atob(base64Body);
    return Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function encodePkcs8Pem(pkcs8Der: readonly number[]): string {
  const base64 = btoa(String.fromCharCode(...pkcs8Der));
  const lines: string[] = [];
  for (let offset = 0; offset < base64.length; offset += PEM_LINE_LENGTH) {
    lines.push(base64.slice(offset, offset + PEM_LINE_LENGTH));
  }
  return [PKCS8_PEM_HEADER, ...lines, PKCS8_PEM_FOOTER, ""].join("\n");
}

/**
 * GitHub issues App private keys as PKCS#1 PEM, but the WebCrypto-backed JWT
 * signing in `@octokit/auth-app` only accepts PKCS#8. Wrapping the PKCS#1 DER
 * in a PKCS#8 PrivateKeyInfo structure is a pure re-encoding, so no key
 * material changes. Inputs that are not PKCS#1 PEM pass through unchanged.
 */
export function normalizeGitHubAppPrivateKeyToPkcs8(privateKey: string): string {
  const pkcs1Der = readPkcs1DerBytes(privateKey);
  if (!pkcs1Der) {
    return privateKey;
  }

  const pkcs8Der = wrapDer(DER_SEQUENCE_TAG, [
    ...DER_VERSION_ZERO,
    ...RSA_ALGORITHM_IDENTIFIER_DER,
    ...wrapDer(DER_OCTET_STRING_TAG, pkcs1Der),
  ]);
  return encodePkcs8Pem(pkcs8Der);
}
