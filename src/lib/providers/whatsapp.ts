// WhatsApp Business Cloud API. Business-started chats need an approved template, so when
// WHATSAPP_TEMPLATE_NAME is set the message text is sent as that template's single body variable.
export const whatsappConfigured = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID);

export async function sendWhatsapp(to: string, text: string): Promise<{ ref: string; delivered: boolean }> {
  if (!whatsappConfigured()) {
    console.log(`[whatsapp:not-configured] to ${to}: ${text}`);
    return { ref: "dev-log", delivered: false };
  }
  const template = process.env.WHATSAPP_TEMPLATE_NAME;
  const body = template
    ? {
        messaging_product: "whatsapp",
        to: to.replace(/^\+/, ""),
        type: "template",
        template: {
          name: template,
          language: { code: process.env.WHATSAPP_TEMPLATE_LANG ?? "en" },
          components: [{ type: "body", parameters: [{ type: "text", text }] }],
        },
      }
    : { messaging_product: "whatsapp", to: to.replace(/^\+/, ""), type: "text", text: { body: text } };
  const res = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string } };
  if (!res.ok || !json.messages?.[0]) throw new Error(`WhatsApp failed: ${json.error?.message ?? res.status}`);
  return { ref: json.messages[0].id, delivered: true };
}
