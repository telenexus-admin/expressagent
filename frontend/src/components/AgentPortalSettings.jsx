import React, {
  useEffect,
  useState,
} from 'react';

const money = value =>
  `KES ${Number(
    value || 0
  ).toLocaleString(
    'en-KE',
    {
      maximumFractionDigits: 2,
    }
  )}`;


function durationText(
  minutes
) {
  const value =
    Number(
      minutes ||
      0
    );

  if (
    value >= 1440 &&
    value % 1440 ===
      0
  ) {
    return `${value / 1440} day(s)`;
  }

  if (
    value >= 60 &&
    value % 60 ===
      0
  ) {
    return `${value / 60} hour(s)`;
  }

  return `${value} min`;
}


async function request(
  path,
  {
    token,
    method = 'GET',
    body,
  } = {}
) {
  const response =
    await fetch(
      `/api/agent-portal/extensions${path}`,
      {
        method,

        headers: {
          Accept:
            'application/json',

          Authorization:
            `Bearer ${token}`,

          ...(body
            ? {
                'Content-Type':
                  'application/json',
              }
            : {}),
        },

        ...(body
          ? {
              body:
                JSON.stringify(
                  body
                ),
            }
          : {}),
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  if (!response.ok) {
    throw new Error(
      data.error ||
      'Request failed'
    );
  }

  return data;
}


async function resizeAvatar(
  file
) {
  if (
    !file ||
    !file.type
      .startsWith(
        'image/'
      )
  ) {
    throw new Error(
      'Choose a valid image.'
    );
  }

  if (
    file.size >
    8 * 1024 * 1024
  ) {
    throw new Error(
      'Image must be smaller than 8 MB.'
    );
  }

  const source =
    await new Promise(
      (
        resolve,
        reject
      ) => {
        const reader =
          new FileReader();

        reader.onload =
          () =>
            resolve(
              reader.result
            );

        reader.onerror =
          () =>
            reject(
              new Error(
                'Could not read image.'
              )
            );

        reader.readAsDataURL(
          file
        );
      }
    );

  const image =
    await new Promise(
      (
        resolve,
        reject
      ) => {
        const item =
          new Image();

        item.onload =
          () =>
            resolve(
              item
            );

        item.onerror =
          () =>
            reject(
              new Error(
                'Could not process image.'
              )
            );

        item.src =
          source;
      }
    );

  const canvas =
    document.createElement(
      'canvas'
    );

  canvas.width =
    320;

  canvas.height =
    320;

  const context =
    canvas.getContext(
      '2d'
    );

  const crop =
    Math.min(
      image.width,
      image.height
    );

  context.drawImage(
    image,
    (
      image.width -
      crop
    ) / 2,
    (
      image.height -
      crop
    ) / 2,
    crop,
    crop,
    0,
    0,
    320,
    320
  );

  return canvas.toDataURL(
    'image/jpeg',
    0.82
  );
}


function NavButton({
  active,
  children,
  onClick,
}) {
  return (
    <button
      type="button"
      onClick={
        onClick
      }
      className={`shrink-0 rounded-xl px-4 py-2.5 text-[10px] font-black ${
        active
          ? 'bg-violet-600 text-white'
          : 'bg-white text-slate-500'
      }`}
    >
      {children}
    </button>
  );
}


export default function AgentPortalSettings({
  dashboard,
  token,
  onReload,
  onNotice,
  onError,
  onLogout,
}) {
  const [
    section,
    setSection,
  ] = useState(
    'meter'
  );

  const [
    saving,
    setSaving,
  ] = useState(
    false
  );

  const [
    editing,
    setEditing,
  ] = useState(
    null
  );

  const [
    administrators,
    setAdministrators,
  ] = useState([]);

  const [
    meter,
    setMeter,
  ] = useState({
    name: '',
    sale_price: '',
    speed_mbps: '',
    duration_minutes: '',
    device_limit: '1',
  });

  const [
    administrator,
    setAdministrator,
  ] = useState({
    name: '',
    email: '',
    phone: '',
    password: '',
    manage_products:
      true,
    manage_profile:
      false,
  });

  const access =
    dashboard.access ||
    {};

  const owner =
    access.role ===
    'owner';

  const products =
    dashboard.products ||
    [];


  useEffect(
    () => {
      if (
        !owner
      ) {
        return;
      }

      request(
        '/administrators',
        {
          token,
        }
      )
        .then(
          result =>
            setAdministrators(
              Array.isArray(
                result
              )
                ? result
                : []
            )
        )
        .catch(
          error =>
            onError?.(
              error.message
            )
        );
    },
    [
      owner,
      token,
    ]
  );


  const resetMeter =
    () => {
      setEditing(
        null
      );

      setMeter({
        name: '',
        sale_price: '',
        speed_mbps: '',
        duration_minutes: '',
        device_limit: '1',
      });
    };


  const saveMeter =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

        const payload = {
          name:
            meter.name,

          sale_price:
            Number(
              meter.sale_price
            ),

          speed_mbps:
            Number(
              meter.speed_mbps
            ),

          duration_minutes:
            Number(
              meter.duration_minutes
            ),

          device_limit:
            Number(
              meter.device_limit
            ),
        };

        if (editing) {
          await request(
            `/products/${editing}`,
            {
              token,
              method:
                'PATCH',
              body:
                payload,
            }
          );

          onNotice?.(
            'Voucher meter updated.'
          );
        } else {
          await request(
            '/products',
            {
              token,
              method:
                'POST',
              body:
                payload,
            }
          );

          onNotice?.(
            'Voucher meter created.'
          );
        }

        resetMeter();

        await onReload?.();
      } catch (
        error
      ) {
        onError?.(
          error.message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const editMeter =
    item => {
      setEditing(
        item.id
      );

      setMeter({
        name:
          item.name ||
          '',

        sale_price:
          String(
            item.sale_price
          ),

        speed_mbps:
          String(
            item.speed_mbps
          ),

        duration_minutes:
          String(
            item.duration_minutes
          ),

        device_limit:
          String(
            item.device_limit
          ),
      });
    };


  const toggleMeter =
    async item => {
      try {
        setSaving(
          true
        );

        await request(
          `/products/${item.id}`,
          {
            token,
            method:
              'PATCH',

            body: {
              name:
                item.name,

              sale_price:
                Number(
                  item.sale_price
                ),

              speed_mbps:
                Number(
                  item.speed_mbps
                ),

              duration_minutes:
                Number(
                  item.duration_minutes
                ),

              device_limit:
                Number(
                  item.device_limit
                ),

              is_active:
                !item.is_active,
            },
          }
        );

        await onReload?.();
      } catch (
        error
      ) {
        onError?.(
          error.message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const changePicture =
    async event => {
      const file =
        event.target
          .files?.[0];

      if (!file) {
        return;
      }

      try {
        setSaving(
          true
        );

        const image =
          await resizeAvatar(
            file
          );

        await request(
          '/profile',
          {
            token,
            method:
              'PUT',

            body: {
              profile_image_data:
                image,
            },
          }
        );

        onNotice?.(
          'Profile picture updated.'
        );

        await onReload?.();
      } catch (
        error
      ) {
        onError?.(
          error.message
        );
      } finally {
        event.target.value =
          '';

        setSaving(
          false
        );
      }
    };


  const removePicture =
    async () => {
      try {
        setSaving(
          true
        );

        await request(
          '/profile',
          {
            token,
            method:
              'PUT',

            body: {
              profile_image_data:
                null,
            },
          }
        );

        await onReload?.();

        onNotice?.(
          'Profile picture removed.'
        );
      } catch (
        error
      ) {
        onError?.(
          error.message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const createAdministrator =
    async event => {
      event.preventDefault();

      try {
        setSaving(
          true
        );

        await request(
          '/administrators',
          {
            token,
            method:
              'POST',

            body: {
              name:
                administrator.name,

              email:
                administrator.email,

              phone:
                administrator.phone,

              password:
                administrator.password,

              permissions: {
                manage_products:
                  administrator
                    .manage_products,

                manage_profile:
                  administrator
                    .manage_profile,
              },
            },
          }
        );

        setAdministrator({
          name: '',
          email: '',
          phone: '',
          password: '',
          manage_products:
            true,
          manage_profile:
            false,
        });

        const result =
          await request(
            '/administrators',
            {
              token,
            }
          );

        setAdministrators(
          result
        );

        onNotice?.(
          'Portal administrator added.'
        );
      } catch (
        error
      ) {
        onError?.(
          error.message
        );
      } finally {
        setSaving(
          false
        );
      }
    };


  const toggleAdministrator =
    async item => {
      try {
        await request(
          `/administrators/${item.id}`,
          {
            token,
            method:
              'PATCH',

            body: {
              status:
                item.status ===
                  'active'
                  ? 'suspended'
                  : 'active',
            },
          }
        );

        const result =
          await request(
            '/administrators',
            {
              token,
            }
          );

        setAdministrators(
          result
        );
      } catch (
        error
      ) {
        onError?.(
          error.message
        );
      }
    };


  return (
    <div className="space-y-4">

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max gap-2 rounded-2xl bg-slate-100 p-1.5">

          <NavButton
            active={
              section ===
              'meter'
            }
            onClick={() =>
              setSection(
                'meter'
              )
            }
          >
            Voucher Meter
          </NavButton>

          <NavButton
            active={
              section ===
              'profile'
            }
            onClick={() =>
              setSection(
                'profile'
              )
            }
          >
            Profile
          </NavButton>

          {owner && (
            <NavButton
              active={
                section ===
                'admins'
              }
              onClick={() =>
                setSection(
                  'admins'
                )
              }
            >
              Administrators
            </NavButton>
          )}

          <NavButton
            active={
              section ===
              'policy'
            }
            onClick={() =>
              setSection(
                'policy'
              )
            }
          >
            Network Policy
          </NavButton>
        </div>
      </div>


      {section ===
      'meter' && (
        <div className="grid gap-4 lg:grid-cols-[370px_minmax(0,1fr)]">

          <form
            onSubmit={
              saveMeter
            }
            className="h-fit rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6"
          >

            <div className="text-[10px] font-black uppercase tracking-[.18em] text-violet-600">
              Voucher Generation Meter
            </div>

            <h3 className="mt-1 text-xl font-black">
              {editing
                ? 'Edit package'
                : 'Create package'}
            </h3>

            <p className="mt-1 text-xs leading-5 text-slate-400">
              Set exactly what your customer pays and receives.
            </p>


            <label className="mt-5 block">
              <span className="text-xs font-black text-slate-600">
                Package name
              </span>

              <input
                value={
                  meter.name
                }
                onChange={
                  event =>
                    setMeter({
                      ...meter,
                      name:
                        event
                          .target
                          .value,
                    })
                }
                placeholder="Example: Quick Connect"
                className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
              />
            </label>


            <label className="mt-4 block">
              <span className="text-xs font-black text-slate-600">
                Selling price
              </span>

              <div className="relative mt-2">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400">
                  KES
                </span>

                <input
                  required
                  type="number"
                  min="1"
                  step="1"
                  value={
                    meter.sale_price
                  }
                  onChange={
                    event =>
                      setMeter({
                        ...meter,
                        sale_price:
                          event
                            .target
                            .value,
                      })
                  }
                  className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-14 pr-4 text-sm font-black outline-none focus:border-violet-400"
                />
              </div>
            </label>


            <div className="mt-4 grid grid-cols-2 gap-3">

              <label>
                <span className="text-xs font-black text-slate-600">
                  Speed
                </span>

                <div className="relative mt-2">
                  <input
                    required
                    type="number"
                    min="0.25"
                    max="1000"
                    step="0.25"
                    value={
                      meter.speed_mbps
                    }
                    onChange={
                      event =>
                        setMeter({
                          ...meter,
                          speed_mbps:
                            event
                              .target
                              .value,
                        })
                    }
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 pr-14 text-sm font-black outline-none focus:border-violet-400"
                  />

                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">
                    Mbps
                  </span>
                </div>
              </label>


              <label>
                <span className="text-xs font-black text-slate-600">
                  Duration
                </span>

                <div className="relative mt-2">
                  <input
                    required
                    type="number"
                    min="1"
                    max="43200"
                    value={
                      meter.duration_minutes
                    }
                    onChange={
                      event =>
                        setMeter({
                          ...meter,
                          duration_minutes:
                            event
                              .target
                              .value,
                        })
                    }
                    className="h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 pr-12 text-sm font-black outline-none focus:border-violet-400"
                  />

                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[9px] font-black text-slate-400">
                    MIN
                  </span>
                </div>
              </label>
            </div>


            <label className="mt-4 block">
              <span className="text-xs font-black text-slate-600">
                Shared devices/users
              </span>

              <input
                required
                type="number"
                min="1"
                max="50"
                value={
                  meter.device_limit
                }
                onChange={
                  event =>
                    setMeter({
                      ...meter,
                      device_limit:
                        event
                          .target
                          .value,
                    })
                }
                className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-black outline-none focus:border-violet-400"
              />
            </label>


            {meter.sale_price &&
              meter.speed_mbps &&
              meter.duration_minutes && (
                <div className="mt-4 rounded-2xl bg-violet-50 p-4">
                  <small className="text-[9px] font-black uppercase tracking-wide text-violet-500">
                    Voucher Preview
                  </small>

                  <strong className="mt-2 block text-sm leading-6 text-violet-950">
                    KES {meter.sale_price}
                    {' · '}
                    {meter.speed_mbps} Mbps
                    {' · '}
                    {durationText(
                      meter.duration_minutes
                    )}
                    {' · '}
                    {meter.device_limit} device(s)
                  </strong>
                </div>
              )}


            <div className="mt-5 flex gap-2">

              {editing && (
                <button
                  type="button"
                  onClick={
                    resetMeter
                  }
                  className="h-12 flex-1 rounded-2xl border border-slate-200 text-xs font-black text-slate-600"
                >
                  Cancel
                </button>
              )}

              <button
                disabled={
                  saving
                }
                className="h-12 flex-1 rounded-2xl bg-violet-600 text-xs font-black text-white disabled:opacity-40"
              >
                {saving
                  ? 'Saving...'
                  : editing
                    ? 'Save changes'
                    : 'Add package'}
              </button>
            </div>
          </form>


          <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[.18em] text-violet-600">
                  Your Selling Catalogue
                </div>

                <h3 className="mt-1 text-xl font-black">
                  Voucher packages
                </h3>
              </div>

              <span className="rounded-xl bg-emerald-50 px-3 py-2 text-[9px] font-black text-emerald-700">
                Agent Controlled
              </span>
            </div>


            <div className="mt-5 grid gap-3 sm:grid-cols-2">

              {products.map(
                item => (
                  <article
                    key={
                      item.id
                    }
                    className={`rounded-2xl border p-4 ${
                      item.is_active
                        ? 'border-violet-100 bg-violet-50/40'
                        : 'border-slate-200 bg-slate-50 opacity-60'
                    }`}
                  >

                    <div className="flex items-start justify-between gap-2">

                      <div>
                        <small className="text-[8px] font-black uppercase text-slate-400">
                          Selling price
                        </small>

                        <strong className="mt-1 block text-xl font-black">
                          {money(
                            item.sale_price
                          )}
                        </strong>
                      </div>

                      <span
                        className={`rounded-full px-2 py-1 text-[8px] font-black ${
                          item.is_active
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-slate-200 text-slate-500'
                        }`}
                      >
                        {item.is_active
                          ? 'ACTIVE'
                          : 'HIDDEN'}
                      </span>
                    </div>


                    <h4 className="mt-4 truncate text-sm font-black">
                      {item.name}
                    </h4>


                    <div className="mt-3 grid grid-cols-3 gap-1.5">

                      <div className="rounded-xl bg-white p-2 text-center">
                        <small className="block text-[7px] uppercase text-slate-400">
                          Speed
                        </small>

                        <b className="mt-1 block text-[9px]">
                          {Number(
                            item.speed_mbps
                          )} Mbps
                        </b>
                      </div>

                      <div className="rounded-xl bg-white p-2 text-center">
                        <small className="block text-[7px] uppercase text-slate-400">
                          Time
                        </small>

                        <b className="mt-1 block text-[9px]">
                          {durationText(
                            item.duration_minutes
                          )}
                        </b>
                      </div>

                      <div className="rounded-xl bg-white p-2 text-center">
                        <small className="block text-[7px] uppercase text-slate-400">
                          Users
                        </small>

                        <b className="mt-1 block text-[9px]">
                          {
                            item.device_limit
                          }
                        </b>
                      </div>
                    </div>


                    <div className="mt-3 grid grid-cols-2 gap-2">

                      <button
                        type="button"
                        onClick={() =>
                          editMeter(
                            item
                          )
                        }
                        className="rounded-xl bg-white py-2 text-[9px] font-black text-violet-700"
                      >
                        Edit
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          toggleMeter(
                            item
                          )
                        }
                        className="rounded-xl bg-white py-2 text-[9px] font-black text-slate-600"
                      >
                        {item.is_active
                          ? 'Hide'
                          : 'Enable'}
                      </button>
                    </div>
                  </article>
                )
              )}


              {!products.length && (
                <div className="col-span-full rounded-2xl border border-dashed border-slate-200 px-5 py-14 text-center">

                  <strong className="text-sm text-slate-700">
                    No voucher packages yet
                  </strong>

                  <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-slate-400">
                    Example: Sell a KES 20 voucher at 2 Mbps for 10 minutes and allow 3 users to share it.
                  </p>
                </div>
              )}
            </div>
          </section>
        </div>
      )}


      {section ===
      'profile' && (
        <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

          <div className="text-[10px] font-black uppercase tracking-[.18em] text-violet-600">
            Business Identity
          </div>

          <h3 className="mt-1 text-xl font-black">
            Profile picture
          </h3>

          <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400">
            This picture becomes your dashboard icon and is also shown beside your business in the network administrator's Agents dashboard.
          </p>


          <div className="mt-6 flex flex-col items-center gap-5 rounded-3xl bg-slate-50 p-6 sm:flex-row sm:items-center">

            {dashboard.agent
              ?.profile_image_data ? (
              <img
                src={
                  dashboard.agent
                    .profile_image_data
                }
                alt=""
                className="h-28 w-28 rounded-[28px] object-cover shadow-lg"
              />
            ) : (
              <div className="flex h-28 w-28 items-center justify-center rounded-[28px] bg-violet-600 text-4xl font-black text-white shadow-lg">
                {String(
                  dashboard.agent
                    ?.name ||
                  'A'
                )
                  .charAt(0)
                  .toUpperCase()}
              </div>
            )}


            <div className="min-w-0 flex-1">

              <h4 className="truncate text-lg font-black">
                {dashboard.agent
                  ?.business_name ||
                 dashboard.agent
                  ?.name}
              </h4>

              <p className="mt-1 truncate text-xs text-slate-400">
                {dashboard.agent
                  ?.email}
              </p>


              <div className="mt-4 flex flex-wrap gap-2">

                <label className="cursor-pointer rounded-xl bg-violet-600 px-4 py-2.5 text-[10px] font-black text-white">
                  Change picture

                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={
                      changePicture
                    }
                    className="hidden"
                  />
                </label>

                {dashboard.agent
                  ?.profile_image_data && (
                  <button
                    type="button"
                    onClick={
                      removePicture
                    }
                    className="rounded-xl bg-rose-50 px-4 py-2.5 text-[10px] font-black text-rose-600"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          </div>
        </section>
      )}


      {section ===
      'admins' &&
      owner && (
        <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">

          <form
            onSubmit={
              createAdministrator
            }
            className="h-fit rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm"
          >

            <div className="text-[10px] font-black uppercase tracking-[.18em] text-violet-600">
              Portal Team
            </div>

            <h3 className="mt-1 text-xl font-black">
              Add administrator
            </h3>

            <p className="mt-1 text-xs leading-5 text-slate-400">
              Create another login for a person who will help manage this specific agent portal.
            </p>


            {[
              [
                'name',
                'Full name',
                'text',
              ],
              [
                'email',
                'Email',
                'email',
              ],
              [
                'phone',
                'Phone number',
                'tel',
              ],
              [
                'password',
                'Password',
                'password',
              ],
            ].map(
              ([
                key,
                label,
                type,
              ]) => (
                <label
                  key={
                    key
                  }
                  className="mt-4 block"
                >
                  <span className="text-xs font-black text-slate-600">
                    {label}
                  </span>

                  <input
                    required
                    type={
                      type
                    }
                    value={
                      administrator[
                        key
                      ]
                    }
                    onChange={
                      event =>
                        setAdministrator({
                          ...administrator,
                          [key]:
                            event
                              .target
                              .value,
                        })
                    }
                    className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-violet-400"
                  />
                </label>
              )
            )}


            <label className="mt-4 flex items-center justify-between rounded-2xl bg-slate-50 p-4">
              <span className="text-xs font-bold text-slate-700">
                Manage voucher meter
              </span>

              <input
                type="checkbox"
                checked={
                  administrator
                    .manage_products
                }
                onChange={
                  event =>
                    setAdministrator({
                      ...administrator,
                      manage_products:
                        event
                          .target
                          .checked,
                    })
                }
              />
            </label>


            <label className="mt-2 flex items-center justify-between rounded-2xl bg-slate-50 p-4">
              <span className="text-xs font-bold text-slate-700">
                Change profile picture
              </span>

              <input
                type="checkbox"
                checked={
                  administrator
                    .manage_profile
                }
                onChange={
                  event =>
                    setAdministrator({
                      ...administrator,
                      manage_profile:
                        event
                          .target
                          .checked,
                    })
                }
              />
            </label>


            <button
              disabled={
                saving
              }
              className="mt-5 h-12 w-full rounded-2xl bg-violet-600 text-xs font-black text-white disabled:opacity-40"
            >
              Add administrator
            </button>
          </form>


          <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm">

            <h3 className="text-lg font-black">
              Portal administrators
            </h3>

            <p className="mt-1 text-xs text-slate-400">
              They sign in using the same Agent Portal page and can only access this agent account.
            </p>


            <div className="mt-5 space-y-2">

              {administrators.map(
                item => (
                  <article
                    key={
                      item.id
                    }
                    className="rounded-2xl border border-slate-100 p-4"
                  >

                    <div className="flex items-start justify-between gap-3">

                      <div className="min-w-0">
                        <strong className="block truncate text-sm">
                          {item.name}
                        </strong>

                        <p className="mt-1 truncate text-[10px] text-slate-400">
                          {item.email}
                          {' · '}
                          {item.phone}
                        </p>
                      </div>

                      <span
                        className={`rounded-full px-2.5 py-1 text-[8px] font-black ${
                          item.status ===
                          'active'
                            ? 'bg-emerald-50 text-emerald-700'
                            : 'bg-rose-50 text-rose-600'
                        }`}
                      >
                        {String(
                          item.status
                        ).toUpperCase()}
                      </span>
                    </div>


                    <div className="mt-3 flex flex-wrap gap-1.5">

                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[8px] font-bold">
                        Wallet
                      </span>

                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[8px] font-bold">
                        Generate vouchers
                      </span>

                      {item.permissions
                        ?.manage_products && (
                        <span className="rounded-full bg-violet-50 px-2 py-1 text-[8px] font-bold text-violet-700">
                          Voucher meter
                        </span>
                      )}

                      {item.permissions
                        ?.manage_profile && (
                        <span className="rounded-full bg-violet-50 px-2 py-1 text-[8px] font-bold text-violet-700">
                          Profile
                        </span>
                      )}
                    </div>


                    <button
                      type="button"
                      onClick={() =>
                        toggleAdministrator(
                          item
                        )
                      }
                      className="mt-3 rounded-xl border border-slate-200 px-3 py-2 text-[9px] font-black text-slate-600"
                    >
                      {item.status ===
                      'active'
                        ? 'Suspend access'
                        : 'Restore access'}
                    </button>
                  </article>
                )
              )}


              {!administrators.length && (
                <div className="py-14 text-center text-xs text-slate-400">
                  No additional administrators yet.
                </div>
              )}
            </div>
          </section>
        </div>
      )}


      {section ===
      'policy' && (
        <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">

          <div className="text-[10px] font-black uppercase tracking-[.18em] text-violet-600">
            Network Policy
          </div>

          <h3 className="mt-1 text-xl font-black">
            Wallet rules
          </h3>

          <p className="mt-1 text-xs leading-5 text-slate-400">
            The network controls wallet funding and bonus rules. Your voucher prices, speeds, durations and shared-user limits are controlled from your Voucher Meter.
          </p>


          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">

            <div className="rounded-2xl bg-violet-50 p-4">
              <small className="text-[8px] font-black uppercase text-violet-500">
                Wallet bonus
              </small>

              <strong className="mt-2 block text-xl text-violet-800">
                {Number(
                  dashboard
                    .settings
                    ?.bonus_percent ||
                  0
                )}%
              </strong>
            </div>


            <div className="rounded-2xl bg-slate-50 p-4">
              <small className="text-[8px] font-black uppercase text-slate-400">
                Min funding
              </small>

              <strong className="mt-2 block text-sm">
                {money(
                  dashboard
                    .settings
                    ?.minimum_funding_amount
                )}
              </strong>
            </div>


            <div className="rounded-2xl bg-slate-50 p-4">
              <small className="text-[8px] font-black uppercase text-slate-400">
                Max funding
              </small>

              <strong className="mt-2 block text-sm">
                {money(
                  dashboard
                    .settings
                    ?.maximum_funding_amount
                )}
              </strong>
            </div>


            <div className="rounded-2xl bg-emerald-50 p-4">
              <small className="text-[8px] font-black uppercase text-emerald-500">
                SMS sharing
              </small>

              <strong className="mt-2 block text-sm text-emerald-800">
                {dashboard
                  .settings
                  ?.sms_enabled
                  ? 'Enabled'
                  : 'Disabled'}
              </strong>
            </div>
          </div>


          <button
            type="button"
            onClick={
              onLogout
            }
            className="mt-6 h-12 w-full rounded-2xl bg-rose-50 text-xs font-black text-rose-600 sm:w-auto sm:px-7"
          >
            Sign out
          </button>
        </section>
      )}
    </div>
  );
}
