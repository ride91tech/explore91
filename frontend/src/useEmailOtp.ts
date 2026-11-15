/**
 * The two-step email-code sign-in, shared by every screen that signs people in.
 *
 * There are two such screens - the app's login and the admin console - and
 * they look nothing alike, so this is a hook rather than a component: each
 * renders its own UI over the same state and the same rules.
 *
 * It is shared rather than written twice because the backend learned that
 * lesson the hard way. Consent was once implemented inline in one sign-in
 * handler, and the other paths silently did without it. The admin console
 * was also still on the dev bypass after the app moved, which would have
 * locked operators out of their own console the day DEV_AUTH_ENABLED closed.
 */
import { useCallback, useState } from "react";
import { useAuth } from "@/src/auth";

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const CODE = /^[0-9]{6}$/;

export type OtpStep = "email" | "code";

/** Server messages are deliberately uniform for failed codes; these only
 *  translate the transport-level cases into something a person can act on. */
function sendError(e: any): string {
  switch (e?.status) {
    case 503: return "Sign-in by email code isn't switched on for this server yet.";
    case 429: return "Too many codes requested for this address. Please wait a while and try again.";
    case 422: return "That doesn't look like an email address.";
    default:  return e?.message ?? "Couldn't send the code. Please try again.";
  }
}

function verifyError(e: any): string {
  switch (e?.status) {
    case 403: return e?.message ?? "You need to confirm you are 18 or older.";
    case 429: return "Too many attempts. Please wait a few minutes, then ask for a new code.";
    case 503: return "Sign-in by email code isn't switched on for this server yet.";
    // 400 carries the server's single message for wrong, expired, used and
    // over-limit codes alike - surface it as-is rather than guessing which.
    default:  return e?.message ?? "That code is wrong or has expired.";
  }
}

export function useEmailOtp() {
  const { requestCode, verifyCode } = useAuth();
  const [step, setStep] = useState<OtpStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCodeRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const emailOk = EMAIL.test(email.trim());
  const codeOk = CODE.test(code);

  /** Keep only digits, max six. Paste of "123 456" or "123-456" still works. */
  const setCode = useCallback((v: string) => {
    setCodeRaw(v.replace(/\D/g, "").slice(0, 6));
    setError(null);
  }, []);

  const send = useCallback(async () => {
    if (!emailOk || busy) return false;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      await requestCode(email.trim());
      setStep("code");
      setCodeRaw("");
      return true;
    } catch (e: any) {
      setError(sendError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [email, emailOk, busy, requestCode]);

  const resend = useCallback(async () => {
    const ok = await send();
    if (ok) setNotice("A new code is on its way. The previous one no longer works.");
  }, [send]);

  /** isAdult is the caller's consent checkbox. Only needed to CREATE an
   *  account; never defaulted to true here, because consent is never inferred. */
  const verify = useCallback(async (isAdult: boolean) => {
    if (!codeOk || busy) return;
    setError(null);
    setBusy(true);
    try {
      await verifyCode(email.trim(), code, isAdult);
    } catch (e: any) {
      setError(verifyError(e));
      setCodeRaw("");
    } finally {
      setBusy(false);
    }
  }, [email, code, codeOk, busy, verifyCode]);

  const changeEmail = useCallback(() => {
    setStep("email");
    setCodeRaw("");
    setError(null);
    setNotice(null);
  }, []);

  return {
    step, email, setEmail: (v: string) => { setEmail(v); setError(null); },
    code, setCode, busy, error, notice,
    emailOk, codeOk, send, resend, verify, changeEmail,
  };
}
