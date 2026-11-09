export const AGENT_FORMATS = Object.freeze(new Set(['agent', 'agent_preview', 'agent_full', 'agent_full_xl']));

export function isAgentFormat(format) {
  return AGENT_FORMATS.has(format);
}
