import { useEffect, useMemo } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { useLogin, useSession } from '@/auth/useSession';
import { useZodForm } from '@/lib/forms/useZodForm';
import { Field, FormErrorSummary } from '@/components/form/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BrandMark } from '@/components/shell/BrandMark';
import { LanguageSwitcher } from '@/components/shell/LanguageSwitcher';

/**
 * Login — `IMPLEMENTATION_PLAN.md` §16.1, `06-api.md` §2, REQ-AUTH-002.
 *
 * The schema mirrors the API's own (`username` max 25, both required), so the
 * obvious mistakes are caught before a request goes out — but the server stays
 * authoritative (§32).
 *
 * A failure shows the API's message verbatim. That message is deliberately
 * generic ("Invalid username or password") because REQ-AUTH-004 forbids
 * revealing whether it was the username, the password, or a deactivated account;
 * rewriting it here would either leak that or make it worse.
 *
 * THE LANGUAGE SWITCH IS ON THIS PAGE ON PURPOSE. Everywhere else it lives in
 * the top bar, which does not exist before sign-in — so a user who reads only
 * Bahasa Indonesia would have had to get through the one screen standing between
 * them and the application in English. It is the same component and the same
 * stored preference, surfaced where it is actually needed.
 *
 * There is no sign-up, no "remember me" and no password reset, because the
 * application has none: `06-api.md` §2 exposes login/refresh/logout/me and
 * nothing else, and offering a reset link that goes nowhere is worse than
 * telling the user who can actually help them.
 */
export function LoginPage() {
  const { t, i18n } = useTranslation();
  const { isAuthenticated } = useSession();
  const location = useLocation();
  const login = useLogin();

  /**
   * Rebuilt when the language changes, so the NEXT validation speaks the
   * language now on screen.
   */
  const loginSchema = useMemo(
    () =>
      z.object({
        username: z
          .string()
          .trim()
          .min(1, t('auth.errors.usernameRequired'))
          .max(25, t('auth.errors.usernameTooLong')),
        password: z.string().min(1, t('auth.errors.passwordRequired')),
      }),
    [t]
  );

  const { form, submit } = useZodForm({
    schema: loginSchema,
    defaultValues: { username: '', password: '' },
    onSubmit: (values) => login.mutateAsync(values),
    // Anything that is not a field-level validation failure — bad credentials, a
    // rate limit, the server being down — belongs above the form.
    onError: (error) => form.setError('root.server', { type: 'server', message: error.message }),
  });

  const {
    register,
    formState: { errors, isSubmitting },
  } = form;

  /**
   * Re-validate the fields that are ALREADY showing a message when the language
   * changes.
   *
   * Rebuilding the schema alone is not enough: a message that has been produced
   * sits in the form state and is not regenerated until something validates
   * again, so switching language would leave the errors stranded in the previous
   * one while every label around them moved.
   *
   * Only fields that already failed are re-triggered — validating a pristine
   * form because someone changed language would accuse them of a mistake they
   * have not made yet.
   *
   * `root.server` is deliberately excluded. That message came from the API and
   * is passed through verbatim (`07-ui.md` §1.3); there is nothing client-side
   * to re-translate, and re-triggering would silently discard it.
   */
  useEffect(() => {
    const failed = Object.keys(form.formState.errors).filter((name) => name !== 'root');
    if (failed.length > 0) form.trigger(failed);
    // `form` is stable; the language is the actual trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i18n.resolvedLanguage]);

  // Already signed in: go where they were headed, or to the dashboard.
  if (isAuthenticated) {
    return <Navigate to={location.state?.from?.pathname ?? '/'} replace />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {/* The switcher sits in the page's own top edge rather than over the card:
          it is a setting, not a step in signing in. */}
      <div className="flex justify-end p-4">
        <LanguageSwitcher />
      </div>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 sm:items-center sm:pb-24">
        <div className="w-full max-w-sm">
          {/*
            Identity above the card, not inside it. The logo answers "whose
            system is this" before the form asks for anything; putting it in the
            card header would make it compete with the form's own heading.
          */}
          <div className="mb-6 flex flex-col items-center gap-2.5 text-center">
            <BrandMark height="h-9" />
            <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
              {t('shell.appName')}
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
            <div className="mb-5 space-y-1">
              <h1 className="text-lg font-semibold tracking-tight">{t('auth.title')}</h1>
              <p className="text-sm text-muted-foreground">{t('auth.subtitle')}</p>
            </div>

            <form onSubmit={submit} noValidate className="space-y-4">
              <FormErrorSummary error={errors.root?.server} />

              <Field label={t('auth.username')} error={errors.username?.message} required>
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    {...register('username')}
                    autoComplete="username"
                    autoFocus
                  />
                )}
              </Field>

              <Field label={t('auth.password')} error={errors.password?.message} required>
                {(fieldProps) => (
                  <Input
                    {...fieldProps}
                    {...register('password')}
                    type="password"
                    autoComplete="current-password"
                  />
                )}
              </Field>

              <Button type="submit" className="w-full" loading={isSubmitting}>
                {t('auth.submit')}
              </Button>
            </form>
          </div>

          {/* No self-service recovery exists, so this names the person who can
              actually unlock an account instead of implying a link. */}
          <p className="mt-5 text-center text-xs leading-relaxed text-muted-foreground">
            {t('auth.help')}
          </p>
        </div>
      </main>
    </div>
  );
}
