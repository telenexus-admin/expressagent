export function isPrivateChatMessage(item) {
  return Boolean(item?.sensitive || item?.private || item?.script);
}

export function messagesForStorage(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((item) => item?.id !== 'welcome' && !isPrivateChatMessage(item))
    .slice(-30)
    .map(({ id, role, text, sources, failed }) => ({ id, role, text, sources, failed }));
}

export function messagesForLLM(messages) {
  return (Array.isArray(messages) ? messages : [])
    .filter((item) => item?.id !== 'welcome' && !isPrivateChatMessage(item))
    .slice(-8)
    .map((item) => ({ role: item.role, content: item.text }));
}
