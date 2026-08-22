const express = require('express');
const crypto = require('crypto');
const http = require('http');
const jwt = require('jsonwebtoken');

const router = express.Router();


function safeEqual(left, right) {
  const a =
    Buffer.from(
      String(left || '')
    );

  const b =
    Buffer.from(
      String(right || '')
    );

  return (
    a.length > 0 &&
    a.length === b.length &&
    crypto.timingSafeEqual(a, b)
  );
}


function authenticateVapi(req, res, next) {
  const expected =
    String(
      process.env
        .VAPI_NEXA_WEBHOOK_TOKEN ||
      ''
    ).trim();


  const authorization =
    String(
      req.headers.authorization ||
      ''
    ).trim();


  const bearer =
    authorization
      .toLowerCase()
      .startsWith('bearer ')
        ? authorization
            .slice(7)
            .trim()
        : '';


  const rawAuthorization =
    bearer
      ? ''
      : authorization;


  const xApiKey =
    String(
      req.headers['x-api-key'] ||
      ''
    ).trim();


  const apiKey =
    String(
      req.headers['api-key'] ||
      ''
    ).trim();


  const candidates = [
    bearer,
    rawAuthorization,
    xApiKey,
    apiKey,
  ].filter(Boolean);


  const authorized =
    Boolean(expected) &&
    candidates.some(
      received =>
        safeEqual(
          received,
          expected
        )
    );


  if (!authorized) {
    return res
      .status(401)
      .json({
        error:
          'Unauthorized Vapi request',
      });
  }


  next();
}

function parseArguments(toolCall) {
  let args =
    toolCall?.arguments ??
    toolCall?.function?.arguments ??
    toolCall?.function?.parameters ??
    {};


  if (
    typeof args === 'string'
  ) {
    try {
      args =
        JSON.parse(args);

    } catch {
      args = {
        question:
          args,
      };
    }
  }


  return (
    args &&
    typeof args === 'object'
      ? args
      : {}
  );
}


function askInternalNexa(
  question,
  clientId
) {
  return new Promise(
    (
      resolve,
      reject
    ) => {

      const internalToken =
        jwt.sign(
          {
            id:
              'vapi-nexa',

            role:
              'admin',

            client_id:
              clientId,

            source:
              'vapi_voice',
          },

          process.env.JWT_SECRET,

          {
            expiresIn:
              '2m',
          }
        );


      const payload =
        JSON.stringify({
          question,

          history:
            [],

          workspace:
            'voice',
        });


      const request =
        http.request(
          {
            hostname:
              '127.0.0.1',

            port:
              Number(
                process.env.PORT ||
                3001
              ),

            path:
              '/api/nexa-knowledge/ask',

            method:
              'POST',

            headers: {
              'Content-Type':
                'application/json',

              'Content-Length':
                Buffer.byteLength(
                  payload
                ),

              Authorization:
                `Bearer ${internalToken}`,
            },

            timeout:
              15000,
          },

          response => {
            let body = '';

            response.setEncoding(
              'utf8'
            );

            response.on(
              'data',
              chunk => {
                body += chunk;

                if (
                  body.length >
                  1024 * 1024
                ) {
                  request.destroy(
                    new Error(
                      'Nexa response too large'
                    )
                  );
                }
              }
            );


            response.on(
              'end',
              () => {
                let data;

                try {
                  data =
                    JSON.parse(
                      body ||
                      '{}'
                    );

                } catch {
                  return reject(
                    new Error(
                      'Invalid Nexa response'
                    )
                  );
                }


                if (
                  response.statusCode <
                    200 ||
                  response.statusCode >=
                    300
                ) {
                  return reject(
                    new Error(
                      data.error ||
                      `Nexa returned HTTP ${response.statusCode}`
                    )
                  );
                }


                resolve(
                  String(
                    data.answer ||
                    ''
                  )
                );
              }
            );
          }
        );


      request.on(
        'timeout',
        () => {
          request.destroy(
            new Error(
              'Nexa request timed out'
            )
          );
        }
      );


      request.on(
        'error',
        reject
      );


      request.write(
        payload
      );

      request.end();
    }
  );
}

/* nexa-manage-billing-v2 */

function billingInternalRequest({
  clientId,
  method,
  path,
  body = {},
}) {
  return new Promise((resolve, reject) => {

    /*
     * id=0 intentionally becomes a non-human actor.
     * client_id remains the authoritative tenant binding.
     */
    const internalToken =
      jwt.sign(
        {
          id: 0,
          role: 'admin',
          client_id: clientId,
          source: 'vapi_voice',
        },
        process.env.JWT_SECRET,
        {
          expiresIn: '2m',
        }
      );


    const payload =
      JSON.stringify(body || {});


    const request =
      http.request(
        {
          hostname: '127.0.0.1',

          port: Number(
            process.env.PORT ||
            3001
          ),

          path,
          method,

          headers: {
            Accept:
              'application/json',

            'Content-Type':
              'application/json',

            'Content-Length':
              Buffer.byteLength(
                payload
              ),

            Authorization:
              `Bearer ${internalToken}`,
          },

          timeout: 30000,
        },

        response => {
          let responseBody = '';

          response.setEncoding(
            'utf8'
          );

          response.on(
            'data',
            chunk => {
              responseBody += chunk;

              if (
                responseBody.length >
                2 * 1024 * 1024
              ) {
                request.destroy(
                  new Error(
                    'Billing response too large'
                  )
                );
              }
            }
          );

          response.on(
            'end',
            () => {
              let data = {};

              try {
                data =
                  responseBody
                    ? JSON.parse(
                        responseBody
                      )
                    : {};
              } catch {
                data = {
                  error:
                    'Invalid billing response',
                };
              }

              resolve({
                statusCode:
                  Number(
                    response.statusCode ||
                    500
                  ),

                data,
              });
            }
          );
        }
      );


    request.on(
      'timeout',
      () => {
        request.destroy(
          new Error(
            'Billing request timed out'
          )
        );
      }
    );


    request.on(
      'error',
      reject
    );


    request.write(payload);
    request.end();
  });
}


function parseBillingBody(args) {

  if (
    args?.body &&
    typeof args.body === 'object' &&
    !Array.isArray(args.body)
  ) {
    return args.body;
  }


  const raw =
    String(
      args?.body_json ||
      ''
    ).trim();


  if (!raw) {
    return {};
  }


  try {
    const parsed =
      JSON.parse(raw);

    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
    ) {
      return parsed;
    }
  } catch {
    // handled below
  }


  throw new Error(
    'body_json must contain a valid JSON object'
  );
}


function latestVapiUserSpeech(message) {

  const messages =
    message?.artifact?.messages;

  if (!Array.isArray(messages)) {
    return '';
  }


  for (
    let i = messages.length - 1;
    i >= 0;
    i -= 1
  ) {
    const item =
      messages[i] || {};

    if (
      String(
        item.role ||
        ''
      ).toLowerCase() !==
      'user'
    ) {
      continue;
    }


    const text =
      String(
        item.message ??
        item.content ??
        item.text ??
        ''
      ).trim();

    if (text) {
      return text;
    }
  }


  return '';
}


function isExplicitYes(value) {

  const text =
    String(value || '')
      .toLowerCase()
      .replace(
        /[^\w\s']/g,
        ' '
      )
      .replace(
        /\s+/g,
        ' '
      )
      .trim();


  if (!text) {
    return false;
  }


  if (
    /\b(no|cancel|stop|wait|don't|dont|do not|not yet|never mind|nevermind)\b/
      .test(text)
  ) {
    return false;
  }


  return /^(yes|confirm|confirmed|proceed|go ahead|do it|yes proceed|yes do it|okay proceed|ok proceed|okay do it|ok do it)$/i
    .test(text);
}




router.get(
  '/health',
  authenticateVapi,
  (_req, res) => {
    res.json({
      ok:
        true,

      service:
        'nexa-vapi-bridge',
    });
  }
);


router.post(
  '/nexa',
  authenticateVapi,

  async (req, res) => {
    const message =
      req.body?.message ||
      {};

    const toolCalls =
      Array.isArray(
        message.toolCallList
      )
        ? message.toolCallList

        : Array.isArray(
            message.toolCalls
          )
          ? message.toolCalls

          : [];


    if (!toolCalls.length) {
      return res
        .status(400)
        .json({
          error:
            'No Vapi tool calls supplied',
        });
    }


    const clientId =
      Number(
        process.env
          .NEXA_VAPI_CLIENT_ID ||
        0
      );


    if (
      !Number.isInteger(
        clientId
      ) ||
      clientId <= 0
    ) {
      return res
        .status(500)
        .json({
          error:
            'Nexa Vapi account binding is not configured',
        });
    }


    const results = [];


    for (
      const toolCall of
      toolCalls
    ) {
      const toolCallId =
        String(
          toolCall?.id ||
          ''
        );


      const name =
        String(
          toolCall?.name ||
          toolCall?.function?.name ||
          ''
        );

      if (
        name ===
        'manage_billing'
      ) {

        const args =
          parseArguments(
            toolCall
          );


        const operation =
          String(
            args.operation ||
            'prepare'
          )
            .trim()
            .toLowerCase();


        /*
         * ==========================
         * CANCEL
         * ==========================
         */

        if (
          operation ===
          'cancel'
        ) {

          results.push({
            toolCallId,

            result:
              JSON.stringify({
                status:
                  'cancelled',

                executed:
                  false,

                message:
                  'Cancelled. No billing change was executed.',
              }),
          });

          continue;
        }


        /*
         * ==========================
         * PREPARE
         * ==========================
         */

        if (
          operation ===
          'prepare'
        ) {

          try {

            const method =
              String(
                args.method ||
                ''
              )
                .trim()
                .toUpperCase();


            let path =
              String(
                args.path ||
                ''
              ).trim();


            if (
              path &&
              !path.startsWith('/')
            ) {
              path = `/${path}`;
            }


            if (
              !method ||
              !path
            ) {
              throw new Error(
                'method and path are required'
              );
            }


            const body =
              parseBillingBody(args);


            const reason =
              String(
                args.reason ||
                ''
              )
                .trim()
                .slice(
                  0,
                  1000
                );


            const prepared =
              await billingInternalRequest({
                clientId,

                method:
                  'POST',

                path:
                  '/api/nexa-actions/prepare',

                body: {
                  method,
                  path,
                  body,
                  reason,

                  source:
                    'nexa_voice',
                },
              });


            if (
              prepared.statusCode <
                200 ||
              prepared.statusCode >=
                300
            ) {

              results.push({
                toolCallId,

                result:
                  JSON.stringify({
                    status:
                      'rejected',

                    executed:
                      false,

                    message:
                      prepared.data?.error ||
                      'Billing Control rejected the operation.',
                  }),
              });

              continue;
            }


            const action =
              prepared.data?.action ||
              {};


            results.push({
              toolCallId,

              result:
                JSON.stringify({
                  status:
                    'prepared',

                  executed:
                    false,

                  confirmation_required:
                    true,

                  action_token:
                    action.action_token,

                  method:
                    action.method ||
                    method,

                  path:
                    action.path ||
                    path,

                  risk_level:
                    action.risk_level ||
                    null,

                  body:
                    action.body ||
                    body,

                  reason,

                  message:
                    'Action prepared but NOT executed. Explain the exact proposed change and ask the user for confirmation.',
                }),
            });


          } catch (error) {

            results.push({
              toolCallId,

              result:
                JSON.stringify({
                  status:
                    'error',

                  executed:
                    false,

                  message:
                    error.message,
                }),
            });
          }


          continue;
        }


        /*
         * ==========================
         * EXECUTE
         * ==========================
         */

        if (
          operation ===
          'execute'
        ) {

          const token =
            String(
              args.action_token ||
              ''
            ).trim();


          if (
            args.confirm !== true
          ) {

            results.push({
              toolCallId,

              result:
                JSON.stringify({
                  status:
                    'confirmation_required',

                  executed:
                    false,

                  message:
                    'Explicit confirmation is required before execution.',
                }),
            });

            continue;
          }


          /*
           * If Vapi supplied the conversation artifact,
           * independently verify that the last user speech
           * was actually an affirmative confirmation.
           */

          const userSpeech =
            latestVapiUserSpeech(
              message
            );


          if (
            userSpeech &&
            !isExplicitYes(
              userSpeech
            )
          ) {

            results.push({
              toolCallId,

              result:
                JSON.stringify({
                  status:
                    'confirmation_required',

                  executed:
                    false,

                  message:
                    'The latest user statement was not a clear confirmation.',
                }),
            });

            continue;
          }


          if (!token) {

            results.push({
              toolCallId,

              result:
                JSON.stringify({
                  status:
                    'error',

                  executed:
                    false,

                  message:
                    'action_token is required for execute.',
                }),
            });

            continue;
          }


          try {

            const executed =
              await billingInternalRequest({
                clientId,

                method:
                  'POST',

                path:
                  `/api/nexa-actions/${encodeURIComponent(token)}/execute`,

                body: {
                  confirm:
                    true,
                },
              });


            if (
              executed.statusCode <
                200 ||
              executed.statusCode >=
                300 ||
              executed.data?.executed !==
                true
            ) {

              results.push({
                toolCallId,

                result:
                  JSON.stringify({
                    status:
                      'failed',

                    executed:
                      false,

                    message:
                      executed.data?.error ||
                      executed.data
                        ?.billing_response
                        ?.error ||
                      'Billing action failed.',

                    details:
                      executed.data,
                  }),
              });

              continue;
            }


            results.push({
              toolCallId,

              result:
                JSON.stringify({
                  status:
                    'executed',

                  executed:
                    true,

                  message:
                    'Billing action completed successfully.',

                  method:
                    executed.data?.method,

                  path:
                    executed.data?.path,

                  result:
                    executed.data?.result,
                }),
            });


          } catch (error) {

            results.push({
              toolCallId,

              result:
                JSON.stringify({
                  status:
                    'error',

                  executed:
                    false,

                  message:
                    error.message,
                }),
            });
          }


          continue;
        }


        results.push({
          toolCallId,

          result:
            JSON.stringify({
              status:
                'error',

              executed:
                false,

              message:
                'operation must be prepare, execute, or cancel',
            }),
        });

        continue;
      }





      if (
        name !==
        'ask_nexa'
      ) {
        results.push({
          toolCallId,

          result:
            'Unsupported Nexa voice tool.',
        });

        continue;
      }


      const args =
        parseArguments(
          toolCall
        );


      const question =
        String(
          args.question ||
          args.query ||
          ''
        )
          .replace(
            /\s+/g,
            ' '
          )
          .trim()
          .slice(
            0,
            1000
          );


      if (!question) {
        results.push({
          toolCallId,

          result:
            'Please provide the account question for Nexa.',
        });

        continue;
      }


      try {
        const answer =
          await askInternalNexa(
            question,
            clientId
          );


        results.push({
          toolCallId,

          result:
            answer ||
            'Nexa could not find enough live account evidence to answer that question.',
        });


      } catch (error) {
        console.error(
          'Vapi -> Nexa tool error:',
          error.message
        );


        results.push({
          toolCallId,

          result:
            'Nexa could not retrieve the live account information right now.',
        });
      }
    }


    res.json({
      results,
    });
  }
);


module.exports = router;
