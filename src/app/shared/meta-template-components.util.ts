export type MetaTemplateButtonType = 'URL' | 'QUICK_REPLY';

export interface MetaTemplateButton {
  type: MetaTemplateButtonType;
  text: string;
  url?: string;
}

export interface MetaTemplateComponentsInput {
  headerText?: string;
  headerExamples?: string[];
  bodyText: string;
  bodyExamples?: string[];
  footerText?: string;
  buttons?: MetaTemplateButton[];
}

function countMetaVariables(text: string): number {
  const matches = text.match(/\{\{\d+\}\}/g) ?? [];
  if (!matches.length) {
    return 0;
  }
  return Math.max(...matches.map((match) => Number(match.replace(/\D/g, ''))));
}

export function buildMetaTemplateComponents(
  input: MetaTemplateComponentsInput,
): Record<string, unknown>[] {
  const components: Record<string, unknown>[] = [];

  const headerText = input.headerText?.trim();
  if (headerText) {
    const headerComponent: Record<string, unknown> = {
      type: 'HEADER',
      format: 'TEXT',
      text: headerText,
    };
    const headerVariableCount = countMetaVariables(headerText);
    if (headerVariableCount > 0) {
      const examples = input.headerExamples ?? [];
      if (examples.length !== headerVariableCount) {
        throw new Error(
          'Faltan ejemplos para las variables del encabezado requeridas por Meta.',
        );
      }
      headerComponent.example = { header_text: examples };
    }
    components.push(headerComponent);
  }

  const bodyComponent: Record<string, unknown> = {
    type: 'BODY',
    text: input.bodyText,
  };
  const bodyVariableCount = countMetaVariables(input.bodyText);
  if (bodyVariableCount > 0) {
    const examples = input.bodyExamples ?? [];
    if (examples.length !== bodyVariableCount) {
      throw new Error(
        'Faltan ejemplos para las variables del mensaje requeridas por Meta.',
      );
    }
    bodyComponent.example = { body_text: [examples] };
  }
  components.push(bodyComponent);

  const footerText = input.footerText?.trim();
  if (footerText) {
    components.push({
      type: 'FOOTER',
      text: footerText,
    });
  }

  if (input.buttons?.length) {
    components.push({
      type: 'BUTTONS',
      buttons: input.buttons.map((button) => {
        const text = button.text.trim();
        if (button.type === 'QUICK_REPLY') {
          return { type: 'QUICK_REPLY', text };
        }
        return {
          type: 'URL',
          text,
          url: button.url?.trim() ?? '',
        };
      }),
    });
  }

  return components;
}
