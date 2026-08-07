const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const db = require('../db');

const {
  sendSMS,
  hasSMSConfig,
} = require('../services/sms');

const router = express.Router();

let schemaPromise = null;


function amount(value) {
  return Math.round(
    Number(value || 0) * 100
  ) / 100;
}


function normalizeEmail(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}


function normalizePhone(value) {
  let phone =
    String(value || '')
      .replace(/\D/g, '');

  if (
    phone.startsWith('0')
  ) {
    phone =
      `254${phone.slice(1)}`;
  }

  if (
    phone.startsWith('7') ||
    phone.startsWith('1')
  ) {
    phone =
      `254${phone}`;
  }

  return phone;
}


function permissionsObject(value) {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value)
  ) {
    return value;
  }

  if (
    typeof value === 'string'
  ) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return {};
    }
  }

  return {};
}


function defaultPermissions() {
  return {
    manage_wallet: true,
    generate_vouchers: true,
    manage_products: true,
    manage_profile: false,
    manage_admins: false,
  };
}


async function ensureAgentPortalExtensionsSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const {
        ensureAgentSchema,
      } = require('./billingAgents');

      await ensureAgentSchema();


      await db.query(`
        ALTER TABLE billing_agents
        ADD COLUMN IF NOT EXISTS
          profile_image_data TEXT
      `);


      await db.query(`
        CREATE TABLE IF NOT EXISTS
        billing_agent_products (
          id BIGSERIAL PRIMARY KEY,

          client_id INTEGER NOT NULL
            REFERENCES clients(id)
            ON DELETE CASCADE,

          agent_id BIGINT NOT NULL
            REFERENCES billing_agents(id)
            ON DELETE CASCADE,

          name VARCHAR(160) NOT NULL,

          sale_price NUMERIC(12,2)
            NOT NULL,

          speed_mbps NUMERIC(10,2)
            NOT NULL,

          duration_minutes INTEGER
            NOT NULL,

          device_limit INTEGER
            NOT NULL DEFAULT 1,

          is_active BOOLEAN
            NOT NULL DEFAULT TRUE,

          created_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW(),

          updated_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW(),

          UNIQUE (
            agent_id,
            sale_price
          )
        )
      `);


      await db.query(`
        CREATE INDEX IF NOT EXISTS
          idx_agent_products_agent

        ON billing_agent_products (
          agent_id,
          is_active,
          sale_price
        )
      `);


      await db.query(`
        CREATE TABLE IF NOT EXISTS
        billing_agent_portal_admins (
          id BIGSERIAL PRIMARY KEY,

          client_id INTEGER NOT NULL
            REFERENCES clients(id)
            ON DELETE CASCADE,

          agent_id BIGINT NOT NULL
            REFERENCES billing_agents(id)
            ON DELETE CASCADE,

          name VARCHAR(180) NOT NULL,

          email VARCHAR(255) NOT NULL,

          phone VARCHAR(40) NOT NULL,

          password_hash TEXT NOT NULL,

          status VARCHAR(20)
            NOT NULL DEFAULT 'active'
            CHECK (
              status IN (
                'active',
                'suspended'
              )
            ),

          permissions JSONB
            NOT NULL DEFAULT '{}'::jsonb,

          last_login_at TIMESTAMPTZ,

          created_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW(),

          updated_at TIMESTAMPTZ
            NOT NULL DEFAULT NOW()
        )
      `);


      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS
          idx_agent_portal_admin_email

        ON billing_agent_portal_admins (
          LOWER(email)
        )
      `);


      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS
          idx_agent_portal_admin_phone

        ON billing_agent_portal_admins (
          phone
        )
      `);


      await db.query(`
        ALTER TABLE billing_hotspot_vouchers
        ALTER COLUMN plan_id
        DROP NOT NULL
      `).catch(error => {
        if (
          error.code !== '42703'
        ) {
          throw error;
        }
      });


      await db.query(`
        ALTER TABLE billing_hotspot_vouchers
        ADD COLUMN IF NOT EXISTS
          agent_product_id BIGINT
      `);

      await db.query(`
        ALTER TABLE billing_hotspot_vouchers
        ADD COLUMN IF NOT EXISTS
          agent_plan_name VARCHAR(160)
      `);

      await db.query(`
        ALTER TABLE billing_hotspot_vouchers
        ADD COLUMN IF NOT EXISTS
          agent_duration_minutes INTEGER
      `);

      await db.query(`
        ALTER TABLE billing_hotspot_vouchers
        ADD COLUMN IF NOT EXISTS
          agent_speed_mbps NUMERIC(10,2)
      `);

      await db.query(`
        ALTER TABLE billing_hotspot_vouchers
        ADD COLUMN IF NOT EXISTS
          agent_rate_limit VARCHAR(160)
      `);


      await db.query(`
        ALTER TABLE billing_agent_generations
        ALTER COLUMN plan_id
        DROP NOT NULL
      `).catch(error => {
        if (
          error.code !== '42703'
        ) {
          throw error;
        }
      });


      await db.query(`
        ALTER TABLE billing_agent_generations
        ADD COLUMN IF NOT EXISTS
          product_id BIGINT
      `);

      await db.query(`
        ALTER TABLE billing_agent_generations
        ADD COLUMN IF NOT EXISTS
          plan_name VARCHAR(160)
      `);

      await db.query(`
        ALTER TABLE billing_agent_generations
        ADD COLUMN IF NOT EXISTS
          duration_minutes INTEGER
      `);

      await db.query(`
        ALTER TABLE billing_agent_generations
        ADD COLUMN IF NOT EXISTS
          speed_mbps NUMERIC(10,2)
      `);


      await db.query(`
        CREATE INDEX IF NOT EXISTS
          idx_agent_generations_product

        ON billing_agent_generations (
          agent_id,
          product_id,
          created_at DESC
        )
      `);
    })().catch(error => {
      schemaPromise = null;
      throw error;
    });
  }

  return schemaPromise;
}


function signPortalAdminToken({
  admin,
  agent,
}) {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is not configured'
    );
  }

  return jwt.sign(
    {
      kind:
        'billing_agent',

      agent_id:
        agent.id,

      client_id:
        agent.client_id,

      portal_admin_id:
        admin.id,

      name:
        admin.name,

      email:
        admin.email,
    },

    process.env.JWT_SECRET,

    {
      expiresIn:
        '12h',
    }
  );
}


async function loadAccessFromToken(req) {
  const header =
    String(
      req.headers.authorization ||
      ''
    );

  if (
    !header.startsWith(
      'Bearer '
    )
  ) {
    const error =
      new Error(
        'Agent login required'
      );

    error.status =
      401;

    throw error;
  }

  const decoded =
    jwt.verify(
      header.slice(7),
      process.env.JWT_SECRET
    );

  if (
    decoded.kind !==
      'billing_agent'
  ) {
    const error =
      new Error(
        'Invalid agent session'
      );

    error.status =
      401;

    throw error;
  }

  await ensureAgentPortalExtensionsSchema();

  const agentResult =
    await db.query(`
      SELECT
        agent.*,

        client.name
          AS network_name,

        client.business_name
          AS network_business_name

      FROM billing_agents
        agent

      JOIN clients
        client
        ON client.id =
           agent.client_id

      WHERE agent.id = $1
        AND agent.client_id = $2

      LIMIT 1
    `, [
      decoded.agent_id,
      decoded.client_id,
    ]);

  const agent =
    agentResult.rows[0];

  if (
    !agent ||
    agent.status !==
      'active'
  ) {
    const error =
      new Error(
        'This agent account is not active'
      );

    error.status =
      403;

    throw error;
  }

  if (
    decoded.portal_admin_id
  ) {
    const adminResult =
      await db.query(`
        SELECT *
        FROM billing_agent_portal_admins

        WHERE id = $1
          AND agent_id = $2
          AND client_id = $3

        LIMIT 1
      `, [
        decoded.portal_admin_id,
        agent.id,
        agent.client_id,
      ]);

    const administrator =
      adminResult.rows[0];

    if (
      !administrator ||
      administrator.status !==
        'active'
    ) {
      const error =
        new Error(
          'This portal administrator account is not active'
        );

      error.status =
        403;

      throw error;
    }

    return {
      agent,

      access: {
        role:
          'administrator',

        administrator_id:
          administrator.id,

        name:
          administrator.name,

        email:
          administrator.email,

        permissions: {
          ...defaultPermissions(),
          ...permissionsObject(
            administrator.permissions
          ),
          manage_admins:
            false,
        },
      },
    };
  }

  return {
    agent,

    access: {
      role:
        'owner',

      administrator_id:
        null,

      name:
        agent.name,

      email:
        agent.email,

      permissions: {
        manage_wallet:
          true,

        generate_vouchers:
          true,

        manage_products:
          true,

        manage_profile:
          true,

        manage_admins:
          true,
      },
    },
  };
}


async function requireAccess(
  req,
  res,
  next
) {
  try {
    const context =
      await loadAccessFromToken(
        req
      );

    req.agent =
      context.agent;

    req.agentAccess =
      context.access;

    return next();
  } catch (error) {
    return res
      .status(
        error.status ||
        401
      )
      .json({
        error:
          error.message ||
          'Agent session expired',
      });
  }
}


function requireOwner(
  req,
  res,
  next
) {
  if (
    req.agentAccess?.role !==
      'owner'
  ) {
    return res.status(403).json({
      error:
        'Only the agent owner can manage portal administrators',
    });
  }

  return next();
}


function requirePermission(
  permission
) {
  return (
    req,
    res,
    next
  ) => {
    if (
      req.agentAccess?.role ===
        'owner' ||
      req.agentAccess
        ?.permissions
        ?.[permission] ===
        true
    ) {
      return next();
    }

    return res.status(403).json({
      error:
        'Your portal administrator account does not have permission for this action',
    });
  };
}


router.post(
  '/team-login',
  async (
    req,
    res
  ) => {
    try {
      await ensureAgentPortalExtensionsSchema();

      const identity =
        String(
          req.body.identity ||
          ''
        ).trim();

      const password =
        String(
          req.body.password ||
          ''
        );

      const email =
        normalizeEmail(
          identity
        );

      const phone =
        normalizePhone(
          identity
        );

      const result =
        await db.query(`
          SELECT
            administrator.*,

            agent.name
              AS agent_name,

            agent.business_name
              AS agent_business_name,

            agent.status
              AS agent_status,

            client.name
              AS network_name,

            client.business_name
              AS network_business_name

          FROM billing_agent_portal_admins
            administrator

          JOIN billing_agents
            agent
            ON agent.id =
               administrator.agent_id

          JOIN clients
            client
            ON client.id =
               administrator.client_id

          WHERE
            LOWER(
              administrator.email
            ) =
            LOWER($1)

            OR administrator.phone =
               $2

          LIMIT 1
        `, [
          email,
          phone,
        ]);

      const administrator =
        result.rows[0];

      if (
        !administrator
      ) {
        return res.status(401).json({
          error:
            'Invalid agent credentials',
        });
      }

      if (
        administrator.status !==
          'active' ||
        administrator.agent_status !==
          'active'
      ) {
        return res.status(403).json({
          error:
            'This portal account is suspended',
        });
      }

      const valid =
        await bcrypt.compare(
          password,
          administrator.password_hash
        );

      if (!valid) {
        return res.status(401).json({
          error:
            'Invalid agent credentials',
        });
      }

      const agent = {
        id:
          administrator.agent_id,

        client_id:
          administrator.client_id,

        name:
          administrator.agent_name,

        business_name:
          administrator.agent_business_name,

        network_name:
          administrator.network_name,

        network_business_name:
          administrator.network_business_name,
      };

      await db.query(`
        UPDATE billing_agent_portal_admins
        SET
          last_login_at = NOW(),
          updated_at = NOW()

        WHERE id = $1
      `, [
        administrator.id,
      ]);

      return res.json({
        token:
          signPortalAdminToken({
            admin:
              administrator,

            agent,
          }),

        access: {
          role:
            'administrator',

          administrator_id:
            administrator.id,

          permissions: {
            ...defaultPermissions(),
            ...permissionsObject(
              administrator.permissions
            ),
            manage_admins:
              false,
          },
        },

        agent: {
          id:
            agent.id,

          name:
            agent.name,

          business_name:
            agent.business_name,

          network_name:
            agent.network_business_name ||
            agent.network_name,
        },
      });
    } catch (error) {
      console.error(
        'Agent team login error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not sign in',
      });
    }
  }
);


router.use(
  requireAccess
);


router.get(
  '/dashboard-data',
  async (
    req,
    res
  ) => {
    try {
      const [
        products,
        generations,
      ] =
        await Promise.all([
          db.query(`
            SELECT *
            FROM billing_agent_products

            WHERE agent_id = $1
              AND client_id = $2

            ORDER BY
              is_active DESC,
              sale_price ASC,
              created_at ASC
          `, [
            req.agent.id,
            req.agent.client_id,
          ]),

          db.query(`
            SELECT
              generation.*,

              voucher.code,

              voucher.status
                AS voucher_status,

              COALESCE(
                generation.plan_name,
                voucher.agent_plan_name,
                plan.name,
                'Agent voucher'
              ) AS resolved_plan_name,

              COALESCE(
                generation.duration_minutes,
                voucher.agent_duration_minutes,
                plan.duration_minutes
              ) AS resolved_duration_minutes,

              COALESCE(
                generation.speed_mbps,
                voucher.agent_speed_mbps
              ) AS resolved_speed_mbps

            FROM billing_agent_generations
              generation

            JOIN billing_hotspot_vouchers
              voucher
              ON voucher.id =
                 generation.voucher_id

            LEFT JOIN billing_hotspot_plans
              plan
              ON plan.id =
                 generation.plan_id
             AND plan.client_id =
                 generation.client_id

            WHERE generation.agent_id = $1
              AND generation.client_id = $2

            ORDER BY
              generation.created_at DESC

            LIMIT 50
          `, [
            req.agent.id,
            req.agent.client_id,
          ]),
        ]);

      const mappedProducts =
        products.rows.map(
          product => ({
            ...product,

            face_value:
              Number(
                product.sale_price
              ),

            plan_name:
              product.name,

            duration_minutes:
              Number(
                product.duration_minutes
              ),

            device_limit:
              Number(
                product.device_limit
              ),

            mikrotik_rate_limit:
              `${Number(
                product.speed_mbps
              )}M/${Number(
                product.speed_mbps
              )}M`,
          })
        );

      const mappedGenerations =
        generations.rows.map(
          generation => ({
            ...generation,

            plan_name:
              generation.resolved_plan_name,

            duration_minutes:
              Number(
                generation.resolved_duration_minutes ||
                0
              ),

            speed_mbps:
              generation.resolved_speed_mbps ===
                null
                ? null
                : Number(
                    generation.resolved_speed_mbps
                  ),
          })
        );

      return res.json({
        agent: {
          profile_image_data:
            req.agent.profile_image_data ||
            null,
        },

        access:
          req.agentAccess,

        products:
          mappedProducts,

        denominations:
          mappedProducts.filter(
            product =>
              product.is_active
          ),

        generations:
          mappedGenerations,
      });
    } catch (error) {
      console.error(
        'Agent extension dashboard error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not load agent voucher configuration',
      });
    }
  }
);


router.get(
  '/products',
  async (
    req,
    res
  ) => {
    const result =
      await db.query(`
        SELECT *
        FROM billing_agent_products

        WHERE agent_id = $1
          AND client_id = $2

        ORDER BY
          is_active DESC,
          sale_price ASC
      `, [
        req.agent.id,
        req.agent.client_id,
      ]);

    return res.json(
      result.rows
    );
  }
);


router.post(
  '/products',
  requirePermission(
    'manage_products'
  ),
  async (
    req,
    res
  ) => {
    try {
      const salePrice =
        amount(
          req.body.sale_price
        );

      const speed =
        Number(
          req.body.speed_mbps
        );

      const duration =
        Number(
          req.body.duration_minutes
        );

      const devices =
        Number(
          req.body.device_limit
        );

      if (
        !Number.isFinite(
          salePrice
        ) ||
        salePrice < 1
      ) {
        return res.status(400).json({
          error:
            'Voucher price must be at least KES 1',
        });
      }

      if (
        !Number.isFinite(
          speed
        ) ||
        speed < 0.25 ||
        speed > 1000
      ) {
        return res.status(400).json({
          error:
            'Speed must be between 0.25 Mbps and 1000 Mbps',
        });
      }

      if (
        !Number.isInteger(
          duration
        ) ||
        duration < 1 ||
        duration > 43200
      ) {
        return res.status(400).json({
          error:
            'Duration must be between 1 minute and 30 days',
        });
      }

      if (
        !Number.isInteger(
          devices
        ) ||
        devices < 1 ||
        devices > 50
      ) {
        return res.status(400).json({
          error:
            'Devices must be between 1 and 50',
        });
      }

      const name =
        String(
          req.body.name ||
          `KES ${salePrice} · ${speed} Mbps`
        )
          .trim()
          .slice(
            0,
            160
          );

      const result =
        await db.query(`
          INSERT INTO
            billing_agent_products
          (
            client_id,
            agent_id,
            name,
            sale_price,
            speed_mbps,
            duration_minutes,
            device_limit
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7
          )

          RETURNING *
        `, [
          req.agent.client_id,
          req.agent.id,
          name,
          salePrice,
          speed,
          duration,
          devices,
        ]);

      return res
        .status(201)
        .json(
          result.rows[0]
        );
    } catch (error) {
      if (
        error.code ===
        '23505'
      ) {
        return res.status(409).json({
          error:
            'You already have a voucher meter using that selling price',
        });
      }

      console.error(
        'Create agent product error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not create voucher meter',
      });
    }
  }
);


router.patch(
  '/products/:id',
  requirePermission(
    'manage_products'
  ),
  async (
    req,
    res
  ) => {
    try {
      const current =
        await db.query(`
          SELECT *
          FROM billing_agent_products

          WHERE id = $1
            AND agent_id = $2
            AND client_id = $3

          LIMIT 1
        `, [
          req.params.id,
          req.agent.id,
          req.agent.client_id,
        ]);

      if (!current.rows[0]) {
        return res.status(404).json({
          error:
            'Voucher meter not found',
        });
      }

      const existing =
        current.rows[0];

      const salePrice =
        amount(
          req.body.sale_price ??
          existing.sale_price
        );

      const speed =
        Number(
          req.body.speed_mbps ??
          existing.speed_mbps
        );

      const duration =
        Number(
          req.body.duration_minutes ??
          existing.duration_minutes
        );

      const devices =
        Number(
          req.body.device_limit ??
          existing.device_limit
        );

      const isActive =
        req.body.is_active ===
          undefined
          ? existing.is_active
          : req.body.is_active ===
              true ||
            req.body.is_active ===
              'true';

      if (
        !Number.isFinite(
          salePrice
        ) ||
        salePrice < 1
      ) {
        return res.status(400).json({
          error:
            'Voucher price must be at least KES 1',
        });
      }

      if (
        !Number.isFinite(
          speed
        ) ||
        speed < 0.25 ||
        speed > 1000
      ) {
        return res.status(400).json({
          error:
            'Speed must be between 0.25 Mbps and 1000 Mbps',
        });
      }

      if (
        !Number.isInteger(
          duration
        ) ||
        duration < 1 ||
        duration > 43200
      ) {
        return res.status(400).json({
          error:
            'Duration must be between 1 minute and 30 days',
        });
      }

      if (
        !Number.isInteger(
          devices
        ) ||
        devices < 1 ||
        devices > 50
      ) {
        return res.status(400).json({
          error:
            'Devices must be between 1 and 50',
        });
      }

      const name =
        String(
          req.body.name ??
          existing.name
        )
          .trim()
          .slice(
            0,
            160
          );

      const result =
        await db.query(`
          UPDATE billing_agent_products

          SET
            name = $1,
            sale_price = $2,
            speed_mbps = $3,
            duration_minutes = $4,
            device_limit = $5,
            is_active = $6,
            updated_at = NOW()

          WHERE id = $7
            AND agent_id = $8
            AND client_id = $9

          RETURNING *
        `, [
          name,
          salePrice,
          speed,
          duration,
          devices,
          isActive,
          existing.id,
          req.agent.id,
          req.agent.client_id,
        ]);

      return res.json(
        result.rows[0]
      );
    } catch (error) {
      if (
        error.code ===
        '23505'
      ) {
        return res.status(409).json({
          error:
            'Another voucher meter already uses that selling price',
        });
      }

      console.error(
        'Update agent product error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not update voucher meter',
      });
    }
  }
);


router.put(
  '/profile',
  requirePermission(
    'manage_profile'
  ),
  async (
    req,
    res
  ) => {
    try {
      const supplied =
        req.body.profile_image_data;

      let image =
        null;

      if (
        supplied !==
          null &&
        supplied !==
          undefined &&
        supplied !==
          ''
      ) {
        image =
          String(
            supplied
          );

        if (
          image.length >
          1500000
        ) {
          return res.status(400).json({
            error:
              'Profile picture is too large',
          });
        }

        if (
          !/^data:image\/(?:jpeg|jpg|png|webp);base64,/i
            .test(image)
        ) {
          return res.status(400).json({
            error:
              'Profile picture must be JPEG, PNG or WebP',
          });
        }
      }

      const result =
        await db.query(`
          UPDATE billing_agents

          SET
            profile_image_data = $1,
            updated_at = NOW()

          WHERE id = $2
            AND client_id = $3

          RETURNING
            id,
            profile_image_data
        `, [
          image,
          req.agent.id,
          req.agent.client_id,
        ]);

      return res.json(
        result.rows[0]
      );
    } catch (error) {
      console.error(
        'Update agent profile image error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not update profile picture',
      });
    }
  }
);


router.get(
  '/administrators',
  requireOwner,
  async (
    req,
    res
  ) => {
    const result =
      await db.query(`
        SELECT
          id,
          name,
          email,
          phone,
          status,
          permissions,
          last_login_at,
          created_at

        FROM billing_agent_portal_admins

        WHERE agent_id = $1
          AND client_id = $2

        ORDER BY
          created_at DESC
      `, [
        req.agent.id,
        req.agent.client_id,
      ]);

    return res.json(
      result.rows
    );
  }
);


router.post(
  '/administrators',
  requireOwner,
  async (
    req,
    res
  ) => {
    try {
      const name =
        String(
          req.body.name ||
          ''
        )
          .trim()
          .slice(
            0,
            180
          );

      const email =
        normalizeEmail(
          req.body.email
        );

      const phone =
        normalizePhone(
          req.body.phone
        );

      const password =
        String(
          req.body.password ||
          ''
        );

      if (!name) {
        return res.status(400).json({
          error:
            'Administrator name is required',
        });
      }

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/
          .test(email)
      ) {
        return res.status(400).json({
          error:
            'Enter a valid administrator email',
        });
      }

      if (
        !/^254[17]\d{8}$/
          .test(phone)
      ) {
        return res.status(400).json({
          error:
            'Enter a valid Kenyan administrator phone number',
        });
      }

      if (
        password.length <
        8
      ) {
        return res.status(400).json({
          error:
            'Administrator password must contain at least 8 characters',
        });
      }

      const permissions = {
        manage_wallet:
          true,

        generate_vouchers:
          true,

        manage_products:
          req.body
            ?.permissions
            ?.manage_products !==
          false,

        manage_profile:
          req.body
            ?.permissions
            ?.manage_profile ===
          true,

        manage_admins:
          false,
      };

      const result =
        await db.query(`
          INSERT INTO
            billing_agent_portal_admins
          (
            client_id,
            agent_id,
            name,
            email,
            phone,
            password_hash,
            permissions
          )

          VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            $7::jsonb
          )

          RETURNING
            id,
            name,
            email,
            phone,
            status,
            permissions,
            created_at
        `, [
          req.agent.client_id,
          req.agent.id,
          name,
          email,
          phone,
          await bcrypt.hash(
            password,
            12
          ),
          JSON.stringify(
            permissions
          ),
        ]);

      return res
        .status(201)
        .json(
          result.rows[0]
        );
    } catch (error) {
      if (
        error.code ===
        '23505'
      ) {
        return res.status(409).json({
          error:
            'That email or phone is already used by another portal administrator',
        });
      }

      console.error(
        'Create agent portal administrator error:',
        error.message
      );

      return res.status(500).json({
        error:
          'Could not create portal administrator',
      });
    }
  }
);


router.patch(
  '/administrators/:id',
  requireOwner,
  async (
    req,
    res
  ) => {
    try {
      const status =
        String(
          req.body.status ||
          ''
        );

      if (
        ![
          'active',
          'suspended',
        ].includes(
          status
        )
      ) {
        return res.status(400).json({
          error:
            'Administrator status is invalid',
        });
      }

      const result =
        await db.query(`
          UPDATE billing_agent_portal_admins

          SET
            status = $1,
            updated_at = NOW()

          WHERE id = $2
            AND agent_id = $3
            AND client_id = $4

          RETURNING
            id,
            name,
            email,
            phone,
            status,
            permissions,
            last_login_at
        `, [
          status,
          req.params.id,
          req.agent.id,
          req.agent.client_id,
        ]);

      if (!result.rows[0]) {
        return res.status(404).json({
          error:
            'Portal administrator not found',
        });
      }

      return res.json(
        result.rows[0]
      );
    } catch (error) {
      return res.status(500).json({
        error:
          'Could not update portal administrator',
      });
    }
  }
);


router.post(
  '/vouchers/generate',
  requirePermission(
    'generate_vouchers'
  ),
  async (
    req,
    res
  ) => {
    await ensureAgentPortalExtensionsSchema();

    const salePrice =
      amount(
        req.body.amount
      );

    if (
      !Number.isFinite(
        salePrice
      ) ||
      salePrice <= 0
    ) {
      return res.status(400).json({
        error:
          'Enter a valid voucher amount',
      });
    }

    const connection =
      await db.connect();

    try {
      await connection.query(
        'BEGIN'
      );

      const productResult =
        await connection.query(`
          SELECT *
          FROM billing_agent_products

          WHERE agent_id = $1
            AND client_id = $2
            AND sale_price = $3
            AND is_active = TRUE

          LIMIT 1
        `, [
          req.agent.id,
          req.agent.client_id,
          salePrice,
        ]);

      const product =
        productResult.rows[0];

      if (!product) {
        throw new Error(
          `KES ${salePrice.toLocaleString()} is not configured in your voucher meter`
        );
      }

      const agentResult =
        await connection.query(`
          SELECT *
          FROM billing_agents

          WHERE id = $1
            AND client_id = $2

          FOR UPDATE
        `, [
          req.agent.id,
          req.agent.client_id,
        ]);

      const agent =
        agentResult.rows[0];

      if (
        !agent ||
        agent.status !==
          'active'
      ) {
        throw new Error(
          'Agent account is not active'
        );
      }

      const balance =
        Number(
          agent.voucher_balance ||
          0
        );

      if (
        balance <
        salePrice
      ) {
        throw new Error(
          `Insufficient voucher credit. Available KES ${balance.toLocaleString()}`
        );
      }

      const speed =
        Number(
          product.speed_mbps
        );

      const duration =
        Number(
          product.duration_minutes
        );

      const devices =
        Number(
          product.device_limit
        );

      const rateLimit =
        `${speed}M/${speed}M`;

      const code = [
        'AG',
        Number(
          agent.id
        )
          .toString(36)
          .toUpperCase(),

        crypto
          .randomBytes(4)
          .toString('hex')
          .toUpperCase(),
      ].join('-');


      const voucherResult =
        await connection.query(`
          INSERT INTO
            billing_hotspot_vouchers
          (
            client_id,
            plan_id,
            code,
            status,
            agent_id,
            face_value,
            max_devices,
            generation_source,
            agent_product_id,
            agent_plan_name,
            agent_duration_minutes,
            agent_speed_mbps,
            agent_rate_limit
          )

          VALUES (
            $1,
            NULL,
            $2,
            'available',
            $3,
            $4,
            $5,
            'agent',
            $6,
            $7,
            $8,
            $9,
            $10
          )

          RETURNING *
        `, [
          agent.client_id,
          code,
          agent.id,
          salePrice,
          devices,
          product.id,
          product.name,
          duration,
          speed,
          rateLimit,
        ]);

      const voucher =
        voucherResult.rows[0];


      const updatedAgent =
        await connection.query(`
          UPDATE billing_agents

          SET
            voucher_balance =
              voucher_balance - $1,

            total_generated =
              total_generated + $1,

            updated_at =
              NOW()

          WHERE id = $2
            AND client_id = $3

          RETURNING
            voucher_balance
        `, [
          salePrice,
          agent.id,
          agent.client_id,
        ]);

      const balanceAfter =
        Number(
          updatedAgent.rows[0]
            .voucher_balance
        );


      const generationResult =
        await connection.query(`
          INSERT INTO
            billing_agent_generations
          (
            client_id,
            agent_id,
            voucher_id,
            plan_id,
            product_id,
            face_value,
            device_limit,
            plan_name,
            duration_minutes,
            speed_mbps
          )

          VALUES (
            $1,
            $2,
            $3,
            NULL,
            $4,
            $5,
            $6,
            $7,
            $8,
            $9
          )

          RETURNING *
        `, [
          agent.client_id,
          agent.id,
          voucher.id,
          product.id,
          salePrice,
          devices,
          product.name,
          duration,
          speed,
        ]);


      await connection.query(`
        INSERT INTO
          billing_agent_wallet_ledger
        (
          client_id,
          agent_id,
          entry_type,
          funding_amount,
          credit_delta,
          balance_after,
          voucher_id,
          reference,
          metadata
        )

        VALUES (
          $1,
          $2,
          'voucher_generation',
          0,
          $3,
          $4,
          $5,
          $6,
          $7::jsonb
        )
      `, [
        agent.client_id,
        agent.id,
        -salePrice,
        balanceAfter,
        voucher.id,
        voucher.code,
        JSON.stringify({
          product_id:
            product.id,

          product_name:
            product.name,

          speed_mbps:
            speed,

          duration_minutes:
            duration,

          device_limit:
            devices,

          immutable_snapshot:
            true,
        }),
      ]);


      await connection.query(
        'COMMIT'
      );

      return res
        .status(201)
        .json({
          generation_id:
            generationResult
              .rows[0]
              .id,

          voucher_id:
            voucher.id,

          code:
            voucher.code,

          amount:
            salePrice,

          product_id:
            product.id,

          plan_name:
            product.name,

          speed_mbps:
            speed,

          duration_minutes:
            duration,

          device_limit:
            devices,

          rate_limit:
            rateLimit,

          balance:
            balanceAfter,
        });
    } catch (error) {
      await connection
        .query(
          'ROLLBACK'
        )
        .catch(
          () => {}
        );

      return res.status(400).json({
        error:
          error.message ||
          'Could not generate voucher',
      });
    } finally {
      connection.release();
    }
  }
);


router.post(
  '/vouchers/:id/sms',
  async (
    req,
    res
  ) => {
    try {
      const phone =
        normalizePhone(
          req.body.phone
        );

      if (
        !/^254[17]\d{8}$/
          .test(phone)
      ) {
        return res.status(400).json({
          error:
            'Enter a valid recipient phone number',
        });
      }

      const result =
        await db.query(`
          SELECT
            generation.*,

            voucher.code,

            COALESCE(
              generation.plan_name,
              voucher.agent_plan_name,
              plan.name,
              'Internet voucher'
            ) AS plan_name,

            COALESCE(
              generation.duration_minutes,
              voucher.agent_duration_minutes,
              plan.duration_minutes
            ) AS duration_minutes,

            COALESCE(
              generation.speed_mbps,
              voucher.agent_speed_mbps
            ) AS speed_mbps,

            client.*

          FROM billing_agent_generations
            generation

          JOIN billing_hotspot_vouchers
            voucher
            ON voucher.id =
               generation.voucher_id

          LEFT JOIN billing_hotspot_plans
            plan
            ON plan.id =
               generation.plan_id
           AND plan.client_id =
               generation.client_id

          JOIN clients
            client
            ON client.id =
               generation.client_id

          WHERE generation.id = $1
            AND generation.agent_id = $2
            AND generation.client_id = $3

          LIMIT 1
        `, [
          req.params.id,
          req.agent.id,
          req.agent.client_id,
        ]);

      const voucher =
        result.rows[0];

      if (!voucher) {
        return res.status(404).json({
          error:
            'Generated voucher not found',
        });
      }

      if (
        !hasSMSConfig({
          client:
            voucher,
        })
      ) {
        return res.status(503).json({
          error:
            'The network SMS provider has not been configured',
        });
      }

      const duration =
        Number(
          voucher.duration_minutes
        );

      const readableDuration =
        duration % 1440 === 0
          ? `${duration / 1440} day(s)`
          : duration % 60 === 0
            ? `${duration / 60} hour(s)`
            : `${duration} minutes`;

      const speed =
        Number(
          voucher.speed_mbps ||
          0
        );

      const message = [
        req.agent
          .network_business_name ||
        req.agent
          .network_name ||
        'Internet Voucher',

        `Voucher: ${voucher.code}`,

        `Price: KES ${Number(
          voucher.face_value
        ).toLocaleString()}`,

        `Package: ${voucher.plan_name}`,

        speed
          ? `Speed: ${speed} Mbps`
          : null,

        `Time: ${readableDuration}`,

        `Devices: ${voucher.device_limit}`,

        'Enter this voucher on the hotspot login page.',
      ]
        .filter(Boolean)
        .join('\n');

      await sendSMS(
        phone,
        message,
        {
          client:
            voucher,
        }
      );

      await db.query(`
        UPDATE billing_agent_generations

        SET
          sms_phone = $1,
          sms_sent_at = NOW()

        WHERE id = $2
          AND agent_id = $3
          AND client_id = $4
      `, [
        phone,
        voucher.id,
        req.agent.id,
        req.agent.client_id,
      ]);

      return res.json({
        sent:
          true,

        phone,
      });
    } catch (error) {
      console.error(
        'Agent extension voucher SMS error:',
        error.message
      );

      return res.status(500).json({
        error:
          error.message ||
          'Could not send voucher by SMS',
      });
    }
  }
);


router.ensureSchema =
  ensureAgentPortalExtensionsSchema;

module.exports =
  router;
