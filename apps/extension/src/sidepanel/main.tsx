import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { isPhoneOtpEnabled, parseAuthIdentifier, type OtpAuthMethod } from "./authIdentifier";
import { getClerkSyncOptions } from "./clerkSync";
import { getAccountPortalOrigin, getClerkFrontendOrigin, getHostedAuthUrl } from "./clerkUrls";
import { ReadMateLogo } from "../shared/ReadMateLogo";
import { AUTH_POPUP_CLOSED_AT_KEY, AUTH_POPUP_WINDOW_ID_KEY, AUTH_SYNC_CHANGED_AT_KEY, cleanupAuthCompletionWindows, closeAuthCompletionWindow, isAuthCompletionTab, isHostedAccountCompletionTab } from "../shared/authPopup";
import "./styles.css";

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
const phoneOtpEnabled = isPhoneOtpEnabled(publishableKey);
type ClerkModule = typeof import("@clerk/chrome-extension");
const sidepanelUrl = chrome.runtime.getURL("sidepanel.html");
const accountPortalOrigin = getAccountPortalOrigin(publishableKey);
const syncHost = (import.meta.env.VITE_CLERK_SYNC_HOST as string | undefined) || getClerkFrontendOrigin(publishableKey);
const clerkSyncOptions = getClerkSyncOptions(chrome.runtime.getManifest(), syncHost);
const hostedAuthUrl = getHostedAuthUrl(accountPortalOrigin);

void cleanupAuthCompletionWindows();

if (publishableKey?.startsWith("pk_test_")) {
  const originalWarn = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    const first = String(args[0] ?? "");
    if (first.includes("Clerk has been loaded with development keys")) return;
    originalWarn(...args);
  };
}

function ClerkEnabledApp() {
  const [clerkModule, setClerkModule] = React.useState<ClerkModule | null>(null);

  React.useEffect(() => {
    if (!publishableKey) return;

    import("@clerk/chrome-extension")
      .then(setClerkModule)
      .catch((error) => {
        console.warn("ReadMate Clerk UI failed to load; using local auth mode.", error);
      });
  }, []);

  if (!clerkModule || !publishableKey) return <AuthUnavailable />;

  const Provider = clerkModule.ClerkProvider;

  return (
    <Provider
      publishableKey={publishableKey}
      afterSignOutUrl={sidepanelUrl}
      signInFallbackRedirectUrl={sidepanelUrl}
      signUpFallbackRedirectUrl={sidepanelUrl}
      allowedRedirectProtocols={["chrome-extension:"]}
      syncHost={clerkSyncOptions.syncHost}
      __experimental_syncHostListener={clerkSyncOptions.enableSyncHostListener}
    >
      <ClerkAuthShell clerkModule={clerkModule} />
    </Provider>
  );
}

function ClerkAuthShell({ clerkModule }: { clerkModule: ClerkModule }) {
  const { isLoaded, isSignedIn, getToken } = clerkModule.useAuth();
  const { user } = clerkModule.useUser();
  const { signOut } = clerkModule.useClerk();

  if (!isLoaded) return <main className="shell">Loading ReadMate...</main>;

  if (!isSignedIn) return <ExtensionSignIn clerkModule={clerkModule} />;

  return (
    <App
      clerk={{
        isConfigured: true,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        userName: user?.fullName ?? user?.primaryEmailAddress?.emailAddress ?? user?.primaryPhoneNumber?.phoneNumber ?? "Signed-in reader",
        avatarUrl: user?.imageUrl,
        getToken,
        signOut,
        UserButton: clerkModule.UserButton
      }}
    />
  );
}

type OtpAuthStep = "identifier" | "code";
type OtpAuthFlow = "sign-in" | "sign-up";

function ExtensionSignIn({ clerkModule }: { clerkModule: ClerkModule }) {
  const signInState = clerkModule.useSignIn();
  const signUpState = clerkModule.useSignUp();
  const [status, setStatus] = React.useState<string | null>(null);
  const [identifier, setIdentifier] = React.useState("");
  const [code, setCode] = React.useState("");
  const [otpStep, setOtpStep] = React.useState<OtpAuthStep>("identifier");
  const [otpFlow, setOtpFlow] = React.useState<OtpAuthFlow>("sign-in");
  const [otpMethod, setOtpMethod] = React.useState<OtpAuthMethod>("email");
  const [otpBusy, setOtpBusy] = React.useState(false);
  const [otpMessage, setOtpMessage] = React.useState<string | null>(null);
  const [otpError, setOtpError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const listener = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
      if (areaName !== "local") return;
      if (Object.keys(changes).some((key) => key.includes("__clerk") || key.includes("clerk") || key === AUTH_POPUP_CLOSED_AT_KEY || key === AUTH_SYNC_CHANGED_AT_KEY)) {
        window.location.reload();
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);

  const openExternalSignIn = async () => {
    setStatus("Finish Google or Apple sign-in in the secure ReadMate window. This panel will update automatically.");
    try {
      const authWindow = await chrome.windows.create({
        url: hostedAuthUrl,
        type: "popup",
        width: 460,
        height: 720,
        focused: true
      });
      if (authWindow.id) {
        await chrome.storage.local.set({ [AUTH_POPUP_WINDOW_ID_KEY]: authWindow.id });
        watchAuthPopupCompletion(authWindow.id, accountPortalOrigin, () => {
          setStatus("Checking your ReadMate sign-in...");
          window.setTimeout(() => window.location.reload(), 250);
        });
      }
    } catch {
      await chrome.tabs.create({ url: hostedAuthUrl, active: true });
    }
  };

  const sendOtpCode = async () => {
    if (!signInState.signIn || !signUpState.signUp) return;
    const credential = parseAuthIdentifier(identifier, phoneOtpEnabled);
    if (!credential) {
      setOtpError(phoneOtpEnabled
        ? "Enter a valid email address or a phone number with country code, for example +1 555 123 4567."
        : "Enter a valid email address.");
      return;
    }

    setOtpBusy(true);
    setOtpError(null);
    setOtpMessage(null);
    setOtpMethod(credential.type);
    try {
      const { error } = credential.type === "email"
        ? await signInState.signIn.emailCode.sendCode({ emailAddress: credential.value })
        : await signInState.signIn.phoneCode.sendCode({ phoneNumber: credential.value, channel: "sms" });
      if (error) throw error;
      setOtpFlow("sign-in");
      setOtpStep("code");
      setOtpMessage(`We sent a one-time code to your ${credential.type === "email" ? "email" : "phone"}.`);
    } catch (signInError) {
      try {
        const createResult = await signUpState.signUp.create(credential.type === "email" ? { emailAddress: credential.value } : { phoneNumber: credential.value });
        if (createResult.error) throw createResult.error;
        const { error } = credential.type === "email"
          ? await signUpState.signUp.verifications.sendEmailCode()
          : await signUpState.signUp.verifications.sendPhoneCode({ channel: "sms" });
        if (error) throw error;
        setOtpFlow("sign-up");
        setOtpStep("code");
        setOtpMessage(`We sent a one-time code to your ${credential.type === "email" ? "email" : "phone"}.`);
      } catch (signUpError) {
        setOtpError(readClerkError(signUpError) ?? readClerkError(signInError) ?? "Could not send a verification code.");
      }
    } finally {
      setOtpBusy(false);
    }
  };

  const verifyOtpCode = async () => {
    if (!signInState.signIn || !signUpState.signUp) return;
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setOtpError(`Enter the one-time code sent to your ${otpMethod === "email" ? "email" : "phone"}.`);
      return;
    }

    setOtpBusy(true);
    setOtpError(null);
    setOtpMessage(null);
    try {
      if (otpFlow === "sign-in") {
        const { error } = otpMethod === "email"
          ? await signInState.signIn.emailCode.verifyCode({ code: trimmedCode })
          : await signInState.signIn.phoneCode.verifyCode({ code: trimmedCode });
        if (error) throw error;
        if (signInState.signIn.status === "needs_second_factor") {
          setOtpError("This account needs another verification step. Use Google, Apple, or the secure account sign-in page.");
          return;
        }
        const finalizeResult = await signInState.signIn.finalize();
        if (finalizeResult.error) throw finalizeResult.error;
        return;
      } else {
        const { error } = otpMethod === "email"
          ? await signUpState.signUp.verifications.verifyEmailCode({ code: trimmedCode })
          : await signUpState.signUp.verifications.verifyPhoneCode({ code: trimmedCode });
        if (error) throw error;
        const finalizeResult = await signUpState.signUp.finalize();
        if (finalizeResult.error) throw finalizeResult.error;
        return;
      }
    } catch (caught) {
      setOtpError(readClerkError(caught) ?? "The code could not be verified.");
    } finally {
      setOtpBusy(false);
    }
  };

  const otpReady = Boolean(signInState.signIn && signUpState.signUp);

  return (
    <main className="shell auth-shell">
      <section className="auth-card">
        <div className="auth-brand-row">
          <ReadMateLogo size="large" />
          <div className="auth-brand-copy">
            <span>ReadMate</span>
            <strong>Sync reading across Chrome and mobile</strong>
          </div>
        </div>

        <div className="auth-header">
          <p className="auth-kicker">{otpStep === "identifier" ? "Account sign-in" : "Verification code"}</p>
          <h1>{otpStep === "identifier" ? "Welcome back" : "Check your inbox"}</h1>
          <p>
            {otpStep === "identifier"
              ? phoneOtpEnabled
                ? "Use email or phone to continue inside the side panel."
                : "Use email to continue inside the side panel."
              : `Enter the one-time code sent to your ${otpMethod === "email" ? "email" : "phone"}.`}
          </p>
        </div>

        <div className="auth-box">
          <div className="phone-auth primary-phone-auth">
            <div>
              <strong>{otpStep === "identifier" ? phoneOtpEnabled ? "Email or phone number" : "Email address" : "One-time code"}</strong>
              <p>{otpStep === "identifier" ? "ReadMate sends a secure code and keeps the flow in this panel." : phoneOtpEnabled ? "Paste the code from email or SMS to finish sign-in." : "Paste the code from email to finish sign-in."}</p>
            </div>
            {otpStep === "identifier" ? (
              <>
                <input
                  value={identifier}
                  onChange={(event) => setIdentifier(event.currentTarget.value)}
                  placeholder={phoneOtpEnabled ? "Email or +1 555 123 4567" : "Email address"}
                  autoComplete="username"
                  inputMode="email"
                  disabled={otpBusy}
                />
                <button className="primary-auth" disabled={!otpReady || otpBusy} onClick={sendOtpCode}>
                  {otpBusy ? "Sending..." : "Send code"}
                </button>
              </>
            ) : (
              <>
                <input
                  value={code}
                  onChange={(event) => setCode(event.currentTarget.value)}
                  placeholder="Enter code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  disabled={otpBusy}
                />
                <button className="primary-auth" disabled={!otpReady || otpBusy} onClick={verifyOtpCode}>
                  {otpBusy ? "Verifying..." : "Verify and continue"}
                </button>
                <button
                  className="secondary-auth-button"
                  disabled={otpBusy}
                  onClick={() => {
                    setOtpStep("identifier");
                    setCode("");
                    setOtpMessage(null);
                    setOtpError(null);
                  }}
                >
                  {phoneOtpEnabled ? "Use a different email or phone" : "Use a different email"}
                </button>
              </>
            )}
            {otpMessage ? <p className="auth-success">{otpMessage}</p> : null}
            {otpError ? <p className="auth-error">{otpError}</p> : null}
          </div>

          <div className="auth-divider"><span>or use a browser sign-in</span></div>

          <div className="oauth-panel">
            <button className="secondary-auth-button oauth-provider-button" onClick={openExternalSignIn}>
              Continue with Google or Apple
            </button>
            <p>OAuth providers open in a secure browser window, then return to ReadMate automatically.</p>
          </div>
          {status ? <p className="oauth-note">{status}</p> : null}
        </div>
      </section>
    </main>
  );
}

function AuthUnavailable() {
  return (
    <main className="shell auth-shell">
      <section className="auth-card">
        <div className="auth-header">
          <h1>Sign-in is unavailable</h1>
          <p>ReadMate needs its Clerk publishable key in the extension build before Chrome and mobile can sync.</p>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ClerkEnabledApp />
  </React.StrictMode>
);

function watchAuthPopupCompletion(windowId: number, trustedAccountPortalOrigin: string, onClosed: () => void) {
  const timeoutAt = Date.now() + 120_000;
  const intervalId = window.setInterval(() => {
    void (async () => {
      if (Date.now() > timeoutAt) {
        window.clearInterval(intervalId);
        return;
      }

      try {
        const authWindow = await chrome.windows.get(windowId, { populate: true });
        const tabs = authWindow.tabs ?? [];
        if (!tabs.some((tab) => isAuthCompletionTab(tab) || isHostedAccountCompletionTab(tab, trustedAccountPortalOrigin))) return;

        window.clearInterval(intervalId);
        if (tabs.some(isAuthCompletionTab)) {
          await closeAuthCompletionWindow(windowId);
        } else {
          await chrome.storage.local.remove(AUTH_POPUP_WINDOW_ID_KEY);
          await chrome.storage.local.set({ [AUTH_POPUP_CLOSED_AT_KEY]: Date.now() });
          await chrome.windows.remove(windowId).catch(() => undefined);
        }
        onClosed();
      } catch {
        window.clearInterval(intervalId);
        onClosed();
      }
    })();
  }, 350);
}

function readClerkError(error: unknown) {
  if (typeof error === "object" && error && "errors" in error) {
    const errors = (error as { errors?: Array<{ longMessage?: string; message?: string }> }).errors;
    return errors?.[0]?.longMessage ?? errors?.[0]?.message ?? null;
  }
  return error instanceof Error ? error.message : null;
}
