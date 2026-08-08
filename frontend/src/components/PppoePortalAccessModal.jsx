import React, {
  useEffect,
  useState,
} from 'react';

import api from '../utils/api';


const field =
  'h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400 focus:bg-white focus:ring-4 focus:ring-violet-100';


export default function PppoePortalAccessModal({
  subscriber,
  close,
}) {
  const [
    loading,
    setLoading,
  ] = useState(
    true
  );

  const [
    saving,
    setSaving,
  ] = useState(
    false
  );

  const [
    error,
    setError,
  ] = useState('');

  const [
    notice,
    setNotice,
  ] = useState('');

  const [
    account,
    setAccount,
  ] = useState(
    null
  );

  const [
    portalUrl,
    setPortalUrl,
  ] = useState(
    `${window.location.origin}/pppoe`
  );

  const [
    form,
    setForm,
  ] = useState({
    login:
      subscriber.account_number ||
      subscriber.radius_username ||
      '',

    password:
      '',

    enabled:
      true,
  });


  useEffect(
    () => {
      let mounted =
        true;

      api
        .get(
          `/billing-workspace/pppoe-portal/subscribers/${subscriber.id}/access`
        )
        .then(
          response => {
            if (!mounted) {
              return;
            }

            const data =
              response.data ||
              {};

            setAccount(
              data.account ||
              null
            );

            setPortalUrl(
              data.portal_url
                ? (
                    data.portal_url
                      .startsWith(
                        'http'
                      )
                      ? data.portal_url
                      : `${window.location.origin}${data.portal_url}`
                  )
                : `${window.location.origin}/pppoe`
            );

            setForm({
              login:
                data.account
                  ?.login ||
                data.suggested_login ||
                '',

              password:
                '',

              enabled:
                data.account
                  ? data.account
                      .enabled !==
                    false
                  : true,
            });
          }
        )
        .catch(
          requestError =>
            setError(
              requestError
                .response
                ?.data
                ?.error ||
              'Could not load portal access.'
            )
        )
        .finally(
          () =>
            mounted &&
            setLoading(
              false
            )
        );

      return () => {
        mounted =
          false;
      };
    },
    [
      subscriber.id,
    ]
  );


  const save =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

        setError('');
        setNotice('');

        const response =
          await api.put(
            `/billing-workspace/pppoe-portal/subscribers/${subscriber.id}/access`,
            form
          );

        setAccount(
          response.data
            ?.account ||
          null
        );

        setForm(
          current => ({
            ...current,
            password:
              '',
          })
        );

        setNotice(
          account
            ? 'Portal access updated.'
            : 'Customer portal created.'
        );
      } catch (
        requestError
      ) {
        setError(
          requestError
            .response
            ?.data
            ?.error ||
          'Could not save portal access.'
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const copyUrl =
    async () => {
      try {
        await navigator
          .clipboard
          .writeText(
            portalUrl
          );

        setNotice(
          'Portal address copied.'
        );
      } catch (_) {
        setNotice(
          portalUrl
        );
      }
    };


  return (
    <div className="fixed inset-0 z-[11000] flex items-end justify-center bg-slate-950/55 backdrop-blur-sm sm:items-center sm:p-5">

      <button
        type="button"
        onClick={
          close
        }
        aria-label="Close customer portal settings"
        className="absolute inset-0"
      />

      <form
        onSubmit={
          save
        }
        className="relative z-10 max-h-[94vh] w-full max-w-md overflow-y-auto rounded-t-[30px] bg-white p-5 shadow-2xl sm:rounded-[30px] sm:p-6"
      >

        <div className="flex items-start justify-between gap-4">

          <div>
            <p className="text-[9px] font-black uppercase tracking-[.2em] text-violet-500">
              PPPoE Customer
            </p>

            <h3 className="mt-1 text-xl font-black text-slate-950">
              Customer Portal
            </h3>

            <p className="mt-1 text-xs text-slate-400">
              {subscriber.full_name}
              {' · '}
              {subscriber.account_number}
            </p>
          </div>

          <button
            type="button"
            onClick={
              close
            }
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-500"
          >
            ×
          </button>
        </div>


        {loading ? (
          <div className="py-14 text-center text-sm text-slate-400">
            Loading portal access...
          </div>
        ) : (
          <>
            <div className="mt-6 rounded-2xl bg-violet-50 p-4">

              <p className="text-[9px] font-black uppercase tracking-wide text-violet-500">
                Login address
              </p>

              <p className="mt-1 break-all text-xs font-bold text-violet-900">
                {portalUrl}
              </p>

              <button
                type="button"
                onClick={
                  copyUrl
                }
                className="mt-3 rounded-xl bg-white px-3 py-2 text-[9px] font-black text-violet-700 shadow-sm"
              >
                Copy portal URL
              </button>
            </div>


            <div className="mt-5 space-y-4">

              <label className="block">

                <span className="text-xs font-black text-slate-600">
                  Portal username
                </span>

                <input
                  required
                  value={
                    form.login
                  }
                  onChange={
                    event =>
                      setForm({
                        ...form,

                        login:
                          event
                            .target
                            .value,
                      })
                  }
                  className={`${field} mt-2`}
                />
              </label>


              <label className="block">

                <span className="text-xs font-black text-slate-600">
                  {account
                    ? 'New password'
                    : 'Portal password'}
                </span>

                <input
                  type="password"
                  required={
                    !account
                  }
                  minLength="8"
                  value={
                    form.password
                  }
                  onChange={
                    event =>
                      setForm({
                        ...form,

                        password:
                          event
                            .target
                            .value,
                      })
                  }
                  placeholder={
                    account
                      ? 'Leave blank to keep current password'
                      : 'At least 8 characters'
                  }
                  className={`${field} mt-2`}
                />

                <small className="mt-1.5 block text-[9px] leading-4 text-slate-400">
                  This is separate from the customer's PPPoE/RADIUS password.
                </small>
              </label>


              <label className="flex items-center justify-between rounded-2xl bg-slate-50 p-4">

                <div>
                  <strong className="block text-xs text-slate-700">
                    Portal access
                  </strong>

                  <span className="mt-1 block text-[9px] text-slate-400">
                    Disable this without disconnecting the customer's internet.
                  </span>
                </div>

                <input
                  type="checkbox"
                  checked={
                    form.enabled
                  }
                  onChange={
                    event =>
                      setForm({
                        ...form,

                        enabled:
                          event
                            .target
                            .checked,
                      })
                  }
                  className="h-5 w-5 accent-violet-600"
                />
              </label>
            </div>


            {account && (
              <div className="mt-4 rounded-2xl border border-slate-100 p-4 text-[10px] text-slate-500">

                <div className="flex justify-between gap-3">

                  <span>
                    Status
                  </span>

                  <b className={
                    account.enabled
                      ? 'text-emerald-600'
                      : 'text-rose-600'
                  }>
                    {account.enabled
                      ? 'Active'
                      : 'Disabled'}
                  </b>
                </div>

                <div className="mt-2 flex justify-between gap-3">

                  <span>
                    Last login
                  </span>

                  <b className="text-right text-slate-700">
                    {account.last_login_at
                      ? new Date(
                          account.last_login_at
                        )
                          .toLocaleString()
                      : 'Never'}
                  </b>
                </div>
              </div>
            )}


            {error && (
              <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2.5 text-xs font-bold text-rose-600">
                {error}
              </div>
            )}

            {notice && (
              <div className="mt-4 rounded-xl bg-emerald-50 px-3 py-2.5 text-xs font-bold text-emerald-700">
                {notice}
              </div>
            )}


            <button
              disabled={
                saving
              }
              className="mt-5 h-12 w-full rounded-2xl bg-violet-600 text-xs font-black text-white disabled:opacity-50"
            >
              {saving
                ? 'Saving...'
                : account
                  ? 'Update Portal Access'
                  : 'Create Customer Portal'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
