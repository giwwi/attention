import type { UiLanguage } from './ui';

interface HandoffNoticeCopy {
  copied: string;
  copyPrompt: string;
  paste: string;
  copyFailed: string;
  returnReply: string;
  copyAgain: string;
  copiedStatus: string;
  copyError: string;
  close: string;
}

export const handoffNoticeCopy: Record<UiLanguage, HandoffNoticeCopy> = {
  ru: {
    copied: 'Промпт Attention уже скопирован',
    copyPrompt: 'Скопировать запрос',
    paste: 'Вставьте его в поле сообщения {provider} ({shortcut}) и отправьте.',
    copyFailed:
      'Не удалось скопировать запрос автоматически. Нажмите кнопку ниже, затем вставьте его в {provider} и отправьте.',
    returnReply:
      'Когда {provider} ответит, скопируйте весь ответ и вставьте его во вкладке настройки Attention.',
    copyAgain: 'Скопировать ещё раз',
    copiedStatus: 'Скопировано ✓',
    copyError: 'Не удалось скопировать. Возьмите запрос во вкладке Attention.',
    close: 'Закрыть',
  },
  en: {
    copied: 'Your Attention prompt is copied',
    copyPrompt: 'Copy the prompt',
    paste: 'Paste it into the {provider} message box ({shortcut}) and send it.',
    copyFailed:
      'The prompt could not be copied automatically. Use the button below, then paste it into {provider} and send it.',
    returnReply:
      'When {provider} replies, copy the entire answer and paste it into the Attention setup tab.',
    copyAgain: 'Copy again',
    copiedStatus: 'Copied ✓',
    copyError: 'Could not copy. You can get the prompt from the Attention tab.',
    close: 'Close',
  },
  de: {
    copied: 'Dein Attention-Prompt ist kopiert',
    copyPrompt: 'Prompt kopieren',
    paste:
      'Füge ihn ins Nachrichtenfeld von {provider} ein ({shortcut}) und sende ihn ab.',
    copyFailed:
      'Der Prompt konnte nicht automatisch kopiert werden. Nutze die Schaltfläche unten, füge ihn in {provider} ein und sende ihn ab.',
    returnReply:
      'Wenn {provider} antwortet, kopiere die gesamte Antwort und füge sie im Tab zur Einrichtung von Attention ein.',
    copyAgain: 'Erneut kopieren',
    copiedStatus: 'Kopiert ✓',
    copyError:
      'Kopieren fehlgeschlagen. Du findest den Prompt im Attention-Tab.',
    close: 'Schließen',
  },
  es: {
    copied: 'La solicitud de Attention está copiada',
    copyPrompt: 'Copiar solicitud',
    paste:
      'Pégala en el campo de mensaje de {provider} ({shortcut}) y envíala.',
    copyFailed:
      'No se pudo copiar automáticamente. Usa el botón de abajo, pégala en {provider} y envíala.',
    returnReply:
      'Cuando {provider} responda, copia toda la respuesta y pégala en la pestaña de configuración de Attention.',
    copyAgain: 'Copiar de nuevo',
    copiedStatus: 'Copiado ✓',
    copyError:
      'No se pudo copiar. La solicitud está en la pestaña de Attention.',
    close: 'Cerrar',
  },
  fr: {
    copied: 'La demande Attention est copiée',
    copyPrompt: 'Copier la demande',
    paste:
      'Collez-la dans le champ de message de {provider} ({shortcut}) et envoyez-la.',
    copyFailed:
      'La copie automatique a échoué. Utilisez le bouton ci-dessous, collez la demande dans {provider} et envoyez-la.',
    returnReply:
      'Quand {provider} répond, copiez la réponse entière et collez-la dans l’onglet de configuration d’Attention.',
    copyAgain: 'Copier à nouveau',
    copiedStatus: 'Copié ✓',
    copyError:
      'Échec de la copie. La demande se trouve dans l’onglet Attention.',
    close: 'Fermer',
  },
  it: {
    copied: 'La richiesta di Attention è copiata',
    copyPrompt: 'Copia la richiesta',
    paste:
      'Incollala nel campo del messaggio di {provider} ({shortcut}) e inviala.',
    copyFailed:
      'La copia automatica non è riuscita. Usa il pulsante qui sotto, incolla la richiesta in {provider} e inviala.',
    returnReply:
      'Quando {provider} risponde, copia l’intera risposta e incollala nella scheda di configurazione di Attention.',
    copyAgain: 'Copia di nuovo',
    copiedStatus: 'Copiato ✓',
    copyError: 'Copia non riuscita. Trovi la richiesta nella scheda Attention.',
    close: 'Chiudi',
  },
  zh: {
    copied: 'Attention 提示词已复制',
    copyPrompt: '复制提示词',
    paste: '将其粘贴到 {provider} 的消息框中（{shortcut}），然后发送。',
    copyFailed:
      '未能自动复制。请点击下方按钮，将提示词粘贴到 {provider} 并发送。',
    returnReply:
      '{provider} 回复后，复制完整回复并粘贴到 Attention 设置标签页中。',
    copyAgain: '重新复制',
    copiedStatus: '已复制 ✓',
    copyError: '复制失败。请从 Attention 标签页获取提示词。',
    close: '关闭',
  },
  ar: {
    copied: 'تم نسخ طلب Attention',
    copyPrompt: 'نسخ الطلب',
    paste: 'الصقه في مربع الرسالة في {provider} ({shortcut}) ثم أرسله.',
    copyFailed:
      'تعذّر النسخ تلقائيًا. استخدم الزر أدناه، ثم الصق الطلب في {provider} وأرسله.',
    returnReply:
      'عندما يرد {provider}، انسخ الرد كاملًا والصقه في علامة تبويب إعداد Attention.',
    copyAgain: 'نسخ مجددًا',
    copiedStatus: 'تم النسخ ✓',
    copyError: 'تعذّر النسخ. يمكنك أخذ الطلب من علامة تبويب Attention.',
    close: 'إغلاق',
  },
  hi: {
    copied: 'Attention का प्रॉम्प्ट कॉपी हो गया है',
    copyPrompt: 'प्रॉम्प्ट कॉपी करें',
    paste:
      'इसे {provider} के संदेश बॉक्स में पेस्ट करें ({shortcut}) और भेजें।',
    copyFailed:
      'अपने आप कॉपी नहीं हो पाया। नीचे दिए बटन का उपयोग करें, फिर {provider} में पेस्ट करके भेजें।',
    returnReply:
      '{provider} के जवाब देने पर पूरा जवाब कॉपी करें और Attention के सेटअप टैब में पेस्ट करें।',
    copyAgain: 'फिर से कॉपी करें',
    copiedStatus: 'कॉपी हो गया ✓',
    copyError: 'कॉपी नहीं हो पाया। Attention टैब से प्रॉम्प्ट ले सकते हैं।',
    close: 'बंद करें',
  },
};
