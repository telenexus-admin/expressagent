import React from 'react';
import {
  AgentIcon,
  BriefcaseIcon,
  ChartIcon,
  ChatIcon,
  CogIcon,
  FlowIcon,
  HomeIcon,
  LifebuoyIcon,
  PulseIcon,
  QuestionIcon,
  TicketIcon,
  UsersIcon,
  WarningIcon,
  WrenchIcon,
} from '../components/Icons';

const sections = [
  {
    title: 'Daily Operations',
    items: [
      {
        icon: HomeIcon,
        title: 'Dashboard',
        body: 'Track support performance, active conversations, human takeovers, resolved cases, message activity and AI health from one overview.',
      },
      {
        icon: ChatIcon,
        title: 'Conversations',
        body: 'View WhatsApp chats, search contacts, filter All, Active or Human conversations, send manual replies, voice notes and manage per-chat agent settings from the three-dot menu.',
      },
      {
        icon: TicketIcon,
        title: 'Tickets',
        body: 'Follow customer issues that need tracking, assign responsibility, update status and keep support work separate from ordinary chat replies.',
      },
      {
        icon: ChartIcon,
        title: 'Invoice Management',
        body: 'Create invoice products, customer invoices, company branding, signatures and due-payment messages that the agent can send to one number or selected groups.',
      },
      {
        icon: WrenchIcon,
        title: 'Inventory',
        body: 'Track stock items such as routers, ONTs, cables and installation equipment, including quantities, reorder levels, unit costs, storage location and archived items.',
      },
      {
        icon: ChartIcon,
        title: 'Billing',
        body: 'Connect and review billing-related customer data, payment checks and account information used by the assistant during support.',
      },
    ],
  },
  {
    title: 'Customer Workflows',
    items: [
      {
        icon: LifebuoyIcon,
        title: 'Human Handover',
        body: 'See customers who requested a human agent, notify responsible employees and resolve handovers after the customer has been assisted.',
      },
      {
        icon: WrenchIcon,
        title: 'Installations',
        body: 'Track installation requests, customer intake details, assigned staff, confirmation actions and installation workflow progress.',
      },
      {
        icon: WarningIcon,
        title: 'Complaints',
        body: 'Review complaint escalations, identify repeated service issues and follow up with customers who need attention outside normal AI replies.',
      },
      {
        icon: FlowIcon,
        title: 'Workflow',
        body: 'Configure which events notify employees, including human requests, installations, complaints and other support triggers.',
      },
    ],
  },
  {
    title: 'Agent And Messaging',
    items: [
      {
        icon: AgentIcon,
        title: 'Agent Configuration',
        body: 'Edit the assistant name, prompt, voice-note behavior, blocked numbers, extra agents and Evolution onboarding status for additional WhatsApp numbers.',
      },
      {
        icon: ChatIcon,
        title: 'SMS Provider',
        body: 'Choose and configure SMS providers such as Blessed Text, Savvy or Talk Sasa, then send test SMS messages before using them in workflows.',
      },
      {
        icon: ChatIcon,
        title: 'Communication',
        body: 'Manage SMS settings, Resend email configuration, sender details, API keys and test delivery for client notifications.',
      },
      {
        icon: PulseIcon,
        title: 'AI Health',
        body: 'Monitor response health, service readiness, failed AI tasks and signals that show whether the assistant is operating normally.',
      },
      {
        icon: ChartIcon,
        title: 'Daily Reports',
        body: 'Review daily summaries for messages, customers, AI replies, handovers and operational activity.',
      },
      {
        icon: ChatIcon,
        title: 'AI Client Remarks',
        body: 'Read customer remarks and AI observations that help admins understand recurring questions, tone and service feedback.',
      },
    ],
  },
  {
    title: 'Team And System',
    items: [
      {
        icon: BriefcaseIcon,
        title: 'Employees',
        body: 'Add staff members, phone numbers and roles so workflows can notify the correct person by WhatsApp.',
      },
      {
        icon: UsersIcon,
        title: 'Admin Management',
        body: 'Create dashboard admins, set login access and control which tabs each admin is allowed to use.',
      },
      {
        icon: ChartIcon,
        title: 'Activity Logs',
        body: 'Audit important admin actions, configuration changes, sign-ins and system activity for accountability.',
      },
      {
        icon: CogIcon,
        title: 'Settings',
        body: 'Manage general client settings, business information and supporting configuration used across the dashboard.',
      },
      {
        icon: QuestionIcon,
        title: 'Documentation',
        body: 'Use this guide when onboarding admins or checking what each dashboard section is meant to do.',
      },
    ],
  },
];

export default function Documentation() {
  return (
    <div className="no-visible-scrollbar h-full overflow-y-auto bg-[#f8faff] px-4 py-5 sm:px-7 sm:py-7">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#6d35ff]">Dashboard guide</p>
            <h2 className="mt-2 text-2xl font-black tracking-normal text-[#0d1438] sm:text-3xl">Documentation</h2>
            <p className="mt-2 max-w-2xl text-sm font-medium leading-6 text-[#657194]">
              A practical guide for admins using the Nexa dashboard, from conversations and workflows to messaging, reports and agent setup.
            </p>
          </div>
          <div className="rounded-2xl border border-[#dce3f1] bg-white px-4 py-3 text-xs font-bold text-[#596482] shadow-sm">
            Start with Conversations, Agent Configuration and Communication when setting up a new client.
          </div>
        </div>

        <div className="space-y-5">
          {sections.map((section) => (
            <section key={section.title} className="rounded-[24px] border border-[#dce3f1] bg-white p-4 shadow-[0_14px_34px_rgba(31,41,80,0.06)] sm:p-5">
              <h3 className="mb-4 text-sm font-black uppercase tracking-[0.12em] text-[#6c7598]">{section.title}</h3>
              <div className="grid gap-3 md:grid-cols-2">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <article key={item.title} className="flex gap-3 rounded-2xl border border-[#e4e9f4] bg-[#fbfcff] p-4">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#efe9ff] text-[#5d2cff]">
                        <Icon className="h-5 w-5" />
                      </span>
                      <div>
                        <h4 className="text-sm font-black text-[#0d1438]">{item.title}</h4>
                        <p className="mt-1 text-sm font-medium leading-6 text-[#657194]">{item.body}</p>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
