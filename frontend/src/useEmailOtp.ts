/**
 * The two-step sign-in-by-code flow, shared by every screen that signs
 * people in, over either channel: a mobile number (codes by WhatsApp) or an
 * email address.
 *
 * There are two such screens - the app's login and the admin console - and
 * they look nothing alike, so this is a hook rather than a component: each
 * renders its own UI over the same state and the same rules.
 *
 * It is shared rather than written per screen because the backend learned
 * that lesson the hard way. Consent was once implemented inline in one
 * sign-in handler and the other paths silently did without it, and the
 * admin console was still on the dev bypass after the app moved - which
 * would have locked operators out the day DEV_AUTH_ENABLED closed.
 */
import { useCallback, useState } from "react";
import { useAuth } from "@/src/auth";

export const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const CODE = /^[0-9]{6}$/;

export type OtpChannel = "phone" | "email";
export type OtpStep = "entry" | "code";

/**
 * Mirrors core.otp.normalise_in_mobile on the server: an Indian mobile in
 * E.164, or null. The server is the authority; this only lets the button
 * disable instead of the request failing, and shows people what will be used.
 */
export function normaliseInMobile(raw: string): string | null {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 12 && d.startsWith("91")) d = d.slice(2);
  else if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length !== 10 || !"6789".includes(d[0])) return null;
  return "+91" + d;
}

/** "+919876543210" -> "+91 98765 43210", for showing back to the user. */
export function formatInMobile(e164: string): string {
  const d = e164.replace(/^\+91/, "");
  return `+91 ${d.slice(0, 5)} ${d.slice(5)}`;
}

function sendError(e: any, channel: OtpChannel): string {
  switch (e?.status) {
    case 503:
      return channel === "phone"
        ? "Sign-in by phone isn't available yet. Use your email instead."
        : "Sign-in by email code isn't switched on for this server yet.";
    case 429:
      return channel === "phone"
        ? "Too many codes requested for this number. Please wait a while and try again."
        : "Too many codes requested for this address. Please wait a while and try again.";
    case 422:
      return channel === "phone"
        ? "Enter a 10-digit Indian mobile number."
        : "That doesn't look like an email address.";
    default:
      return e?.message ?? "Couldn't send the code. Please try again.";
  }
}

function verifyError(e: any): string {
  switch (e?.status) {
    case 403: return e?.message ?? "You need to confirm you are 18 or older.";
    case 429: return "Too many attempts. Please wait a few minutes, then ask for a new code.";
    case 503: return "Sign-in by code isn't available right now.";
    // 400 carries the server's single message for wrong, expired, used and
    // over-limit codes alike - surface it as-is rather than guessing which.
    default:  return e?.message ?? "That code is wrong or has expired.";
  }
}

export function useOtp(channel: OtpChannel) {
  const { requestCode, verifyCode, requestPhoneCode, verifyPhoneCode } = useAuth();
  const [step, setStep] = useState<OtpStep>("entry");
  const [value, setValueRaw] = useState("");
  const [code, setCodeRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const phone = channel === "phone" ? normaliseInMobile(value) : null;
  const valueOk = channel === "phone" ? phone !== null : EMAIL.test(value.trim());
  const codeOk = CODE.test(code);
  /** What the code was sent to, in the form to show the person. */
  const sentTo = channel === "phone" ? (phone ? formatInMobile(phone) : value) : value.trim();

  const setValue = useCallback((v: string) => { setValueRaw(v); setError(null); }, []);

  /** Keep only digits, max six. Paste of "123 456" or "123-456" still works. */
  const setCode = useCallback((v: string) => {
    setCodeRaw(v.replace(/\D/g, "").slice(0, 6));
    setError(null);
  }, []);

  const send = useCallback(async () => {
    if (!valueOk || busy) return false;
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (channel === "phone") await requestPhoneCode(phone as string);
      else await requestCode(value.trim());
      setStep("code");
      setCodeRaw("");
      return true;
    } catch (e: any) {
      setError(sendError(e, channel));
      return false;
    } finally {
      setBusy(false);
    }
  }, [channel, value, phone, valueOk, busy, requestCode, requestPhoneCode]);

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
      if (channel === "phone") await verifyPhoneCode(phone as string, code, isAdult);
      else await verifyCode(value.trim(), code, isAdult);
    } catch (e: any) {
      setError(verifyError(e));
      setCodeRaw("");
    } finally {
      setBusy(false);
    }
  }, [channel, value, phone, code, codeOk, busy, verifyCode, verifyPhoneCode]);

  /** Back to the first step, keeping what was typed. */
  const changeEntry = useCallback(() => {
    setStep("entry");
    setCodeRaw("");
    setError(null);
    setNotice(null);
  }, []);

  return {
    channel, step, value, setValue, valueOk, sentTo,
    code, setCode, codeOk, busy, error, notice,
    send, resend, verify, changeEntry,
  };
}

/**
 * The email-only flow under its original names, for the admin console:
 * operators sign in by email because the admin allowlist is by email.
 */
export function useEmailOtp() {
  const o = useOtp("email");
  return {
    step: o.step === "entry" ? ("email" as const) : ("code" as const),
    email: o.value, setEmail: o.setValue, emailOk: o.valueOk,
    code: o.code, setCode: o.setCode, codeOk: o.codeOk,
    busy: o.busy, error: o.error, notice: o.notice,
    send: o.send, resend: o.resend, verify: o.verify, changeEmail: o.changeEntry,
  };
}
