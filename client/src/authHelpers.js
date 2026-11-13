// Pure form validation for the login page. No imports, so the server's Vitest can test it too.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors the server: email valid and at most 254 chars; signup password 8 chars to 72 bytes.
// Returns { email?, password? } with one message per invalid field.
export function validateAuth(mode, email, password) {
  const errors = {};
  if (!EMAIL_RE.test(email) || email.length > 254)
    errors.email = "Enter a valid email address.";
  if (mode === "signup") {
    if (password.length < 8)
      errors.password = "Password must be at least 8 characters.";
    else if (new TextEncoder().encode(password).length > 72)
      errors.password = "Password must be at most 72 bytes.";
  } else if (!password) {
    errors.password = "Enter your password.";
  }
  return errors;
}
