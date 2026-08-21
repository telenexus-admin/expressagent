const https = require('https');


function postJson(url, payload, headers = {}) {
  return new Promise(
    (resolve, reject) => {

      const target =
        new URL(url);

      const body =
        JSON.stringify(payload);


      const request =
        https.request(
          {
            protocol:
              target.protocol,

            hostname:
              target.hostname,

            port:
              target.port ||
              443,

            path:
              `${target.pathname}${target.search}`,

            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json',

              'Content-Length':
                Buffer.byteLength(body),

              ...headers,
            },

            timeout:
              15000,
          },

          response => {

            let data = '';

            response.setEncoding(
              'utf8'
            );


            response.on(
              'data',
              chunk => {

                data += chunk;

                if (
                  data.length >
                  1024 * 1024
                ) {
                  request.destroy(
                    new Error(
                      'Vapi response exceeded limit'
                    )
                  );
                }
              }
            );


            response.on(
              'end',
              () => {

                let parsed = {};

                try {
                  parsed =
                    JSON.parse(
                      data ||
                      '{}'
                    );
                } catch {
                  parsed = {};
                }


                if (
                  response.statusCode >=
                    200 &&
                  response.statusCode <
                    300
                ) {
                  return resolve({
                    statusCode:
                      response.statusCode,

                    data:
                      parsed,
                  });
                }


                const message =
                  parsed.message ||
                  parsed.error ||
                  data ||
                  `HTTP ${response.statusCode}`;


                const error =
                  new Error(
                    `Vapi returned ${response.statusCode}: ${message}`
                  );

                error.statusCode =
                  response.statusCode;

                reject(error);
              }
            );
          }
        );


      request.on(
        'timeout',
        () => {

          request.destroy(
            new Error(
              'Vapi request timed out'
            )
          );
        }
      );


      request.on(
        'error',
        reject
      );


      request.write(body);
      request.end();
    }
  );
}


function cleanVoiceText(
  value,
  fallback = ''
) {
  return String(
    value ??
    fallback
  )
    .replace(
      /\s+/g,
      ' '
    )
    .trim()
    .slice(
      0,
      500
    );
}


async function callRouterOfflineAlert({
  router,
  downtimeMinutes,
  downtimeSeconds,
  lastSeen,
  failureCount,
}) {

  const privateKey =
    cleanVoiceText(
      process.env
        .VAPI_PRIVATE_API_KEY
    );


  const assistantId =
    cleanVoiceText(
      process.env
        .VAPI_ALERT_ASSISTANT_ID
    );


  const phoneNumberId =
    cleanVoiceText(
      process.env
        .VAPI_ALERT_PHONE_NUMBER_ID
    );


  const destination =
    cleanVoiceText(
      process.env
        .VAPI_ALERT_DESTINATION
    );


  if (
    !privateKey ||
    !assistantId ||
    !phoneNumberId ||
    !destination
  ) {
    throw new Error(
      'Vapi router-alert configuration is incomplete'
    );
  }


  const routerName =
    cleanVoiceText(
      router?.last_identity ||
      router?.name ||
      `Router ${router?.id || ''}`,
      'MikroTik router'
    );


  const routerId =
    String(
      router?.id ||
      ''
    );


  /* nexa-fast-duration-support */

  const suppliedSeconds =
    Number(downtimeSeconds || 0);


  const useSeconds =
    Number.isFinite(suppliedSeconds) &&
    suppliedSeconds > 0 &&
    suppliedSeconds < 60;


  const seconds =
    Math.max(
      1,
      Math.round(
        suppliedSeconds || 0
      )
    );


  const minutes =
    Math.max(
      1,
      Number(
        downtimeMinutes ||
        1
      )
    );


  const durationText =
    useSeconds
      ? `${seconds} ${seconds === 1 ? 'second' : 'seconds'}`
      : `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;


  const failures =
    Math.max(
      2,
      Number(
        failureCount ||
        2
      )
    );


  const lastSeenText =
    cleanVoiceText(
      lastSeen,
      'not available'
    );


  /*
   * This overrides only the opening message.
   * The saved Nexa assistant remains attached,
   * including ask_nexa.
   */

  const firstMessage =
    (
      `Nexa network alert. ` +
      `${routerName} has gone offline. ` +
      `I confirmed the outage after ${failures} failed checks. ` +
      `The router has been unreachable for approximately ${durationText}. ` +
      `Last confirmed contact was ${lastSeenText}. ` +
      `I am calling to notify you. ` +
      `You can ask me about this router, affected subscribers, ` +
      `collections, or anything else in the account.`
    );


  const payload = {
    assistantId,

    phoneNumberId,

    customer: {
      number:
        destination,
    },

    assistantOverrides: {

      firstMessage,

      firstMessageMode:
        'assistant-speaks-first',

      firstMessageInterruptionsEnabled:
        true,

      variableValues: {

        alert_type:
          'router_offline',

        router_id:
          routerId,

        router_name:
          routerName,

        downtime_minutes:
          String(minutes),

        failed_checks:
          String(failures),

        last_seen:
          lastSeenText,
      },
    },
  };


  const apiBase =
    String(
      process.env.VAPI_API_BASE ||
      'https://api.vapi.ai'
    )
      .replace(
        /\/+$/,
        ''
      );


  let lastError = null;


  /*
   * Retry once for temporary transport/server
   * problems. Do not retry authentication or
   * malformed-request failures.
   */

  for (
    let attempt = 1;
    attempt <= 2;
    attempt += 1
  ) {

    try {

      const response =
        await postJson(
          `${apiBase}/call`,

          payload,

          {
            Authorization:
              `Bearer ${privateKey}`,
          }
        );


      console.log(
        '[Nexa Vapi] Router offline call created',
        {
          routerId:
            routerId,

          routerName:
            routerName,

          callId:
            response.data?.id ||
            null,

          status:
            response.data?.status ||
            null,
        }
      );


      return {
        success:
          true,

        callId:
          response.data?.id ||
          null,

        status:
          response.data?.status ||
          null,
      };


    } catch (error) {

      lastError =
        error;


      const status =
        Number(
          error.statusCode ||
          0
        );


      if (
        status >= 400 &&
        status < 500
      ) {
        break;
      }


      if (
        attempt <
        2
      ) {
        await new Promise(
          resolve =>
            setTimeout(
              resolve,
              2000
            )
        );
      }
    }
  }


  console.error(
    '[Nexa Vapi] Router offline call failed',
    {
      routerId,
      routerName,

      error:
        lastError?.message ||
        'Unknown Vapi error',
    }
  );


  return {
    success:
      false,

    error:
      lastError?.message ||
      'Vapi call failed',
  };
}


module.exports = {
  callRouterOfflineAlert,
};
