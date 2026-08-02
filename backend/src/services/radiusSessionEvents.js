const db = require('../db');
const { recordBillingEvent } = require('./events');
const { getOnlineUsernames, listRecentRadiusSessions, radiusEnabled } = require('./radiusSync');
const {
  observeTwinEntities,
  observeTwinRelationship,
} = require('./digitalTwin');

let running = false;
let timer;

async function ensureRadiusSessionEventSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS billing_radius_session_event_state (
      client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      radius_session_id VARCHAR(160) NOT NULL,
      started_event_at TIMESTAMP WITH TIME ZONE,
      stopped_event_at TIMESTAMP WITH TIME ZONE,
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      PRIMARY KEY (client_id, radius_session_id)
    );
    CREATE INDEX IF NOT EXISTS idx_radius_session_event_state_updated
      ON billing_radius_session_event_state(client_id, updated_at DESC);
  `);
}

async function pollRadiusSessionEvents() {
  if (running || !radiusEnabled()) return;
  running = true;
  try {
    await ensureRadiusSessionEventSchema();
    const subscriberResult = await db.query(
      `SELECT id, client_id, radius_username, router_id
       FROM billing_subscribers
       WHERE radius_username IS NOT NULL AND radius_username <> ''
       ORDER BY client_id, id`
    );
    const byClient = new Map();
    for (const subscriber of subscriberResult.rows) {
      if (!byClient.has(subscriber.client_id)) byClient.set(subscriber.client_id, []);
      byClient.get(subscriber.client_id).push(subscriber);
    }

    for (const [clientId, subscribers] of byClient.entries()) {
      const subscriberByUsername = new Map(
        subscribers.map((subscriber) => [String(subscriber.radius_username), subscriber])
      );
      const usernames = [...subscriberByUsername.keys()];
      const [sessions, onlineUsernames] = await Promise.all([
        listRecentRadiusSessions(usernames, 15),
        getOnlineUsernames(usernames),
      ]);
      const observations = subscribers.map((subscriber) => {
        const online = onlineUsernames.has(String(subscriber.radius_username));
        return {
          clientId,
          eventType: online ? 'subscriber.connected' : 'subscriber.disconnected',
          category: 'radius',
          source: 'radius_accounting_live',
          entityType: 'subscriber',
          entityId: subscriber.id,
          state: {
            online,
            operational_status: online ? 'online' : 'offline',
            radius_username: subscriber.radius_username,
            observed_from: 'radius_accounting',
          },
          observedAt: new Date(),
          sensitivity: 'restricted',
        };
      });
      const sessionIds = sessions.map((session) => String(session.radacctid));
      const stateResult = sessionIds.length
        ? await db.query(
          `SELECT radius_session_id, started_event_at, stopped_event_at
           FROM billing_radius_session_event_state
           WHERE client_id = $1 AND radius_session_id = ANY($2::text[])`,
          [clientId, sessionIds]
        )
        : { rows: [] };
      const stateById = new Map(stateResult.rows.map((state) => [String(state.radius_session_id), state]));
      for (const session of sessions) {
        const subscriber = subscriberByUsername.get(String(session.username));
        if (!subscriber) continue;
        const sessionId = String(session.radacctid);
        const state = stateById.get(sessionId);
        const sessionActive = !session.acctstoptime;
        observations.push({
          clientId,
          eventType: sessionActive ? 'radius.session_started' : 'radius.session_stopped',
          category: 'radius',
          source: 'radius_accounting_live',
          entityType: 'radius_session',
          entityId: sessionId,
          state: {
            online: sessionActive,
            operational_status: sessionActive ? 'online' : 'offline',
            username: session.username,
            started_at: session.acctstarttime,
            updated_at: session.acctupdatetime,
            stopped_at: session.acctstoptime,
            session_seconds: session.acctsessiontime,
            upload_bytes: session.acctinputoctets,
            download_bytes: session.acctoutputoctets,
            framed_ip_address: session.framedipaddress,
            nas_ip_address: session.nasipaddress,
            terminate_cause: session.acctterminatecause,
          },
          observedAt: session.acctupdatetime || session.acctstoptime || session.acctstarttime || new Date(),
          severity: !sessionActive && /lost|reject|error|timeout/i.test(String(session.acctterminatecause || ''))
            ? 'warning' : 'info',
          sensitivity: 'restricted',
        });
        if (!state?.started_event_at) await recordBillingEvent({
          clientId,
          eventType: 'radius.session_started',
          category: 'radius',
          source: 'radius_accounting',
          entityType: 'radius_session',
          entityId: sessionId,
          actorType: 'subscriber',
          actorId: subscriber.id,
          severity: 'info',
          title: 'RADIUS session started',
          description: `${session.username} connected`,
          payload: {
            username: session.username,
            started_at: session.acctstarttime,
            framed_ip_address: session.framedipaddress,
            nas_ip_address: session.nasipaddress,
            calling_station_id: session.callingstationid,
            called_station_id: session.calledstationid,
          },
          relatedEntities: [
            { entityType: 'subscriber', entityId: subscriber.id, relationship: 'subscriber' },
            ...(subscriber.router_id ? [{ entityType: 'router', entityId: subscriber.router_id, relationship: 'router' }] : []),
          ],
          deduplicationKey: `radius-session:${sessionId}:started`,
          occurredAt: session.acctstarttime || new Date(),
          sensitivity: 'restricted',
        });

        if (session.acctstoptime && !state?.stopped_event_at) {
          await recordBillingEvent({
            clientId,
            eventType: 'radius.session_stopped',
            category: 'radius',
            source: 'radius_accounting',
            entityType: 'radius_session',
            entityId: sessionId,
            actorType: 'system',
            severity: /lost|reject|error|timeout/i.test(String(session.acctterminatecause || '')) ? 'warning' : 'info',
            title: 'RADIUS session stopped',
            description: `${session.username} disconnected`,
            payload: {
              username: session.username,
              started_at: session.acctstarttime,
              stopped_at: session.acctstoptime,
              session_seconds: session.acctsessiontime,
              upload_bytes: session.acctinputoctets,
              download_bytes: session.acctoutputoctets,
              terminate_cause: session.acctterminatecause,
              framed_ip_address: session.framedipaddress,
              nas_ip_address: session.nasipaddress,
            },
            relatedEntities: [
              { entityType: 'subscriber', entityId: subscriber.id, relationship: 'subscriber' },
              ...(subscriber.router_id ? [{ entityType: 'router', entityId: subscriber.router_id, relationship: 'router' }] : []),
            ],
            deduplicationKey: `radius-session:${sessionId}:stopped`,
            occurredAt: session.acctstoptime,
            sensitivity: 'restricted',
          });
        }
        if (!state?.started_event_at || (session.acctstoptime && !state?.stopped_event_at)) {
          await db.query(
            `INSERT INTO billing_radius_session_event_state
               (client_id, radius_session_id, started_event_at, stopped_event_at)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (client_id, radius_session_id) DO UPDATE SET
               started_event_at=COALESCE(billing_radius_session_event_state.started_event_at, EXCLUDED.started_event_at),
               stopped_event_at=COALESCE(billing_radius_session_event_state.stopped_event_at, EXCLUDED.stopped_event_at),
               updated_at=NOW()`,
            [
              clientId,
              sessionId,
              session.acctstarttime || new Date(),
              session.acctstoptime || null,
            ]
          );
        }
        if (!state?.started_event_at || (session.acctstoptime && !state?.stopped_event_at)) {
          const active = !session.acctstoptime;
          const observedAt = session.acctstoptime || session.acctupdatetime || session.acctstarttime || new Date();
          await observeTwinRelationship({
            clientId,
            fromEntityType: 'radius_session',
            fromEntityId: sessionId,
            relationship: 'subscriber',
            toEntityType: 'subscriber',
            toEntityId: subscriber.id,
            active,
            observedAt,
            attributes: { username: session.username },
          });
          if (subscriber.router_id) await observeTwinRelationship({
            clientId,
            fromEntityType: 'radius_session',
            fromEntityId: sessionId,
            relationship: 'router',
            toEntityType: 'router',
            toEntityId: subscriber.router_id,
            active,
            observedAt,
          });
        }
      }
      await observeTwinEntities(observations);
    }
  } catch (error) {
    console.error('RADIUS session event poll failed:', error.message);
  } finally {
    running = false;
  }
}

function startRadiusSessionEventScheduler() {
  ensureRadiusSessionEventSchema()
    .then(() => pollRadiusSessionEvents())
    .catch((error) => console.error('RADIUS session event schema failed:', error.message));
  timer = setInterval(pollRadiusSessionEvents, 30000);
  timer.unref?.();
}

module.exports = {
  ensureRadiusSessionEventSchema,
  pollRadiusSessionEvents,
  startRadiusSessionEventScheduler,
};
