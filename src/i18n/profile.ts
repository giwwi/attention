import { normalizeUiLanguage, type UiLanguage } from './ui';

// The first column is the source label. User-entered profile values are never
// passed through this dictionary; only interface labels and status messages are.
const languages = [
  'ru',
  'en',
  'de',
  'es',
  'fr',
  'it',
  'zh',
  'ar',
  'hi',
] as const;
const rows = `
Личный контекст|Personal context|Persönlicher Kontext|Contexto personal|Contexte personnel|Contesto personale|个人背景|السياق الشخصي|व्यक्तिगत संदर्भ
Сначала — ваш профиль|First, your profile|Zuerst dein Profil|Primero, tu perfil|D’abord, votre profil|Prima, il tuo profilo|先创建个人资料|ملفك الشخصي أولًا|पहले, आपकी प्रोफ़ाइल
Начните с ChatGPT или Claude, с которым вы уже общались. Он поможет описать ваши цели, интересы и знакомые темы. Можно начать с одного, а потом добавить профиль из другого.|Start with ChatGPT or Claude, whichever you already use. It can help describe your goals, interests and familiar topics. Start with one, then add a profile from the other if you like.|Beginne mit ChatGPT oder Claude, je nachdem, welchen du bereits nutzt. Er kann deine Ziele, Interessen und vertrauten Themen beschreiben. Starte mit einem und ergänze später ein Profil aus dem anderen.|Empieza con ChatGPT o Claude, el que ya uses. Te ayudará a describir tus objetivos, intereses y temas conocidos. Empieza con uno y luego añade un perfil del otro si quieres.|Commencez avec ChatGPT ou Claude, celui que vous utilisez déjà. Il vous aidera à décrire vos objectifs, intérêts et sujets familiers. Commencez avec l’un, puis ajoutez un profil de l’autre si vous le souhaitez.|Inizia con ChatGPT o Claude, quello che usi già. Ti aiuterà a descrivere obiettivi, interessi e argomenti familiari. Inizia con uno, poi aggiungi un profilo dall’altro se vuoi.|从你用过的 ChatGPT 或 Claude 开始。它可以帮助描述你的目标、兴趣和熟悉的主题。 可以先用一个，再添加另一个生成的资料。|ابدأ بـ ChatGPT أو Claude الذي تستخدمه بالفعل. سيساعدك في وصف أهدافك واهتماماتك والمواضيع المألوفة لديك. ابدأ بأحدهما، ثم أضف ملفًا من الآخر إن أحببت.|ChatGPT या Claude से शुरू करें, जिसे आप पहले से उपयोग करते हैं। यह आपके लक्ष्य, रुचियाँ और परिचित विषय बताने में मदद करेगा। एक से शुरू करें, फिर चाहें तो दूसरे की प्रोफ़ाइल भी जोड़ें।
После сохранения профиля появятся рекомендации, что читать.|Once you save your profile, you’ll get recommendations on what to read.|Sobald du dein Profil speicherst, bekommst du Lesetipps.|Al guardar tu perfil, recibirás recomendaciones de lectura.|Une fois votre profil enregistré, vous recevrez des conseils de lecture.|Dopo aver salvato il profilo, riceverai consigli di lettura.|保存资料后，你就会收到阅读建议。|بعد حفظ ملفك، ستحصل على اقتراحات لما تقرأه.|प्रोफ़ाइल सहेजने के बाद आपको पढ़ने के सुझाव मिलेंगे।
Другие способы|Other ways|Andere Möglichkeiten|Otras opciones|Autres méthodes|Altri modi|其他方式|طرق أخرى|अन्य तरीके
Нет истории чатов? Создайте подробный профиль вручную: укажите интересы, текущие цели и то, что уже знаете.|No chat history? Build a detailed profile yourself: add your interests, current goals and what you already know.|Kein Chatverlauf? Erstelle selbst ein ausführliches Profil mit Interessen, aktuellen Zielen und vorhandenem Wissen.|¿Sin historial de chats? Crea un perfil detallado con tus intereses, objetivos actuales y lo que ya sabes.|Pas d’historique de chats ? Créez un profil détaillé avec vos intérêts, objectifs actuels et connaissances.|Nessuna cronologia di chat? Crea un profilo dettagliato con interessi, obiettivi attuali e conoscenze.|没有聊天记录？手动填写详细资料，包括兴趣、当前目标和已有知识。|ليس لديك سجل محادثات؟ أنشئ ملفًا مفصلًا باهتماماتك وأهدافك الحالية وما تعرفه بالفعل.|चैट इतिहास नहीं है? अपनी रुचियाँ, वर्तमान लक्ष्य और मौजूदा ज्ञान जोड़कर विस्तृत प्रोफ़ाइल बनाएँ।
Добавьте ваши интересы, цели или знакомые темы. Одних настроек формата недостаточно.|Add your interests, goals or familiar topics. Format preferences alone are not enough.|Ergänze Interessen, Ziele oder vertraute Themen. Formatvorlieben allein reichen nicht aus.|Añade intereses, objetivos o temas conocidos. Las preferencias de formato no bastan.|Ajoutez vos intérêts, objectifs ou sujets familiers. Les préférences de format seules ne suffisent pas.|Aggiungi interessi, obiettivi o argomenti familiari. Le sole preferenze di formato non bastano.|请添加兴趣、目标或熟悉的主题。仅有格式偏好还不够。|أضف اهتماماتك أو أهدافك أو مواضيعك المألوفة. تفضيلات التنسيق وحدها لا تكفي.|रुचियाँ, लक्ष्य या परिचित विषय जोड़ें। केवल प्रारूप की पसंद पर्याप्त नहीं है।
В ответах недостаточно конкретного контекста. Добавьте интересы, цели и знакомые темы.|Your answers need more context. Add interests, goals and familiar topics.|Deine Antworten brauchen mehr Kontext. Ergänze Interessen, Ziele und vertraute Themen.|Falta contexto en tus respuestas. Añade intereses, objetivos y temas conocidos.|Vos réponses manquent de contexte. Ajoutez intérêts, objectifs et sujets familiers.|Serve più contesto. Aggiungi interessi, obiettivi e argomenti familiari.|回答缺少具体信息。请添加兴趣、目标和熟悉的主题。|تحتاج إجاباتك إلى سياق أوضح. أضف اهتمامات وأهدافًا ومواضيع مألوفة.|उत्तर में अधिक संदर्भ चाहिए। रुचियाँ, लक्ष्य और परिचित विषय जोड़ें।
Настройки|Settings|Einstellungen|Ajustes|Réglages|Impostazioni|设置|الإعدادات|सेटिंग
Готово|Done|Fertig|Listo|Terminé|Fatto|完成|تم|पूरा
Другой AI|Other AI|Andere KI|Otra IA|Autre IA|Altra IA|其他 AI|ذكاء اصطناعي آخر|अन्य AI
Вручную|Manual|Manuell|Manual|Manuel|Manuale|手动|يدوي|मैन्युअल
Быстрая AI-настройка|Quick AI setup|KI-Schnelleinrichtung|Configuración rápida con IA|Configuration IA rapide|Configurazione IA rapida|AI 快速设置|إعداد سريع بالذكاء الاصطناعي|त्वरित AI सेटअप
Низкий|Low|Niedrig|Bajo|Faible|Basso|低|منخفض|कम
Средний|Medium|Mittel|Medio|Moyen|Medio|中|متوسط|मध्यम
Высокий|High|Hoch|Alto|Élevé|Alto|高|مرتفع|उच्च
Активна|Active|Aktiv|Activa|Active|Attivo|进行中|نشط|सक्रिय
На паузе|Paused|Pausiert|En pausa|En pause|In pausa|已暂停|متوقف مؤقتًا|रुका हुआ
Завершена|Completed|Abgeschlossen|Completada|Terminée|Completato|已完成|مكتمل|पूर्ण
Начальный|Beginner|Anfänger|Principiante|Débutant|Principiante|初级|مبتدئ|शुरुआती
Продвинутый|Advanced|Fortgeschritten|Avanzado|Avancé|Avanzato|高级|متقدم|उन्नत
Экспертный|Expert|Experte|Experto|Expert|Esperto|专家|خبير|विशेषज्ञ
Продемонстрировано|Demonstrated|Nachgewiesen|Demostrado|Démontré|Dimostrato|已展示|مثبت|प्रदर्शित
Указано напрямую|Explicitly stated|Ausdrücklich angegeben|Declarado explícitamente|Déclaré explicitement|Dichiarato esplicitamente|明确说明|مذكور صراحة|स्पष्ट रूप से बताया
Предположение|Inferred|Abgeleitet|Inferido|Déduit|Dedotto|推测|مستنتج|अनुमानित
Неизвестно|Unknown|Unbekannt|Desconocido|Inconnu|Sconosciuto|未知|غير معروف|अज्ञात
Знакомое|Familiar|Vertrautes|Familiar|Familier|Familiare|熟悉内容|مألوف|परिचित
Баланс|Balanced|Ausgewogen|Equilibrado|Équilibré|Equilibrato|均衡|متوازن|संतुलित
Новое|New|Neues|Nuevo|Nouveau|Nuovo|新内容|جديد|नया
Жанр|Genre|Genre|Género|Genre|Genere|类型|نوع|शैली
Формат|Format|Format|Formato|Format|Formato|形式|صيغة|प्रारूप
Автор|Creator|Urheber|Creador|Créateur|Autore|创作者|منشئ|रचनाकार
Тема для отдыха|Leisure topic|Freizeitthema|Tema de ocio|Sujet de loisir|Tema di svago|休闲主题|موضوع ترفيهي|मनोरंजन का विषय
Не нравится|Dislike|Abneigung|No me gusta|Je n’aime pas|Non mi piace|不喜欢|لا يعجبني|पसंद नहीं
Личный контекст пока не настроен.|Personal context is not configured yet.|Persönlicher Kontext ist noch nicht eingerichtet.|El contexto personal aún no está configurado.|Le contexte personnel n’est pas encore configuré.|Il contesto personale non è ancora configurato.|尚未设置个人背景。|لم يُعدّ السياق الشخصي بعد.|व्यक्तिगत संदर्भ अभी सेट नहीं है।
Личный контекст: {count} · хранится локально.|Personal context: {count} entries · stored locally.|Persönlicher Kontext: {count} Einträge · lokal gespeichert.|Contexto personal: {count} entradas · guardado localmente.|Contexte personnel : {count} éléments · stockés localement.|Contesto personale: {count} voci · salvate localmente.|个人背景：{count} 项 · 本地存储。|السياق الشخصي: {count} عناصر · محفوظ محليًا.|व्यक्तिगत संदर्भ: {count} प्रविष्टियाँ · स्थानीय रूप से सुरक्षित।
Уверенность от 0 до 1|Confidence from 0 to 1|Sicherheit von 0 bis 1|Confianza de 0 a 1|Confiance de 0 à 1|Confidenza da 0 a 1|置信度 0 到 1|درجة الثقة من 0 إلى 1|विश्वास स्तर 0 से 1
Обычная длительность отдыха в минутах|Typical leisure time in minutes|Übliche Freizeitdauer in Minuten|Tiempo habitual de ocio en minutos|Durée habituelle de loisir en minutes|Durata abituale dello svago in minuti|通常休闲时长（分钟）|مدة الترفيه المعتادة بالدقائق|सामान्य मनोरंजन समय, मिनट
Добавьте хотя бы один пункт или настройку предпочтений.|Add at least one entry or preference.|Mindestens einen Eintrag oder eine Präferenz hinzufügen.|Añade al menos una entrada o preferencia.|Ajoutez au moins un élément ou une préférence.|Aggiungi almeno una voce o preferenza.|请添加至少一项信息或偏好。|أضف عنصرًا أو تفضيلًا واحدًا على الأقل.|कम से कम एक प्रविष्टि या पसंद जोड़ें।
Текстовые поля не должны быть пустыми.|Text fields cannot be empty.|Textfelder dürfen nicht leer sein.|Los campos de texto no pueden estar vacíos.|Les champs de texte ne peuvent pas être vides.|I campi di testo non possono essere vuoti.|文本字段不能为空。|لا يمكن ترك الحقول النصية فارغة.|टेक्स्ट फ़ील्ड खाली नहीं हो सकते।
Уверенность и сила интереса должны быть числами от 0 до 1.|Confidence and interest strength must be between 0 and 1.|Sicherheit und Interessenstärke müssen zwischen 0 und 1 liegen.|La confianza y el interés deben estar entre 0 y 1.|La confiance et l’intérêt doivent être entre 0 et 1.|Confidenza e interesse devono essere tra 0 e 1.|置信度和兴趣强度必须在 0 到 1 之间。|يجب أن تكون الثقة وقوة الاهتمام بين 0 و1.|विश्वास और रुचि का स्तर 0 से 1 के बीच होना चाहिए।
Обычная длительность отдыха должна быть от 1 до 480 минут.|Leisure time must be between 1 and 480 minutes.|Die Freizeitdauer muss zwischen 1 und 480 Minuten liegen.|El tiempo de ocio debe ser de 1 a 480 minutos.|La durée doit être comprise entre 1 et 480 minutes.|La durata deve essere tra 1 e 480 minuti.|休闲时间必须在 1 到 480 分钟之间。|يجب أن تكون المدة بين 1 و480 دقيقة.|समय 1 से 480 मिनट के बीच होना चाहिए।
Быстрая AI-настройка сейчас недоступна.|Quick AI setup is unavailable. Configure AI in settings first.|KI-Schnelleinrichtung nicht verfügbar. Zuerst KI einrichten.|Configura primero la IA en los ajustes.|Configurez d’abord l’IA dans les réglages.|Configura prima l’IA nelle impostazioni.|快速设置不可用，请先配置 AI。|أعدّ الذكاء الاصطناعي في الإعدادات أولًا.|पहले सेटिंग में AI कॉन्फ़िगर करें।
Не удалось подготовить профиль. Попробуйте ещё раз.|Could not prepare the profile. Check AI settings and try again.|Profil konnte nicht erstellt werden. KI-Einstellungen prüfen.|No se pudo crear el perfil. Revisa la configuración de IA.|Profil non créé. Vérifiez les réglages IA et réessayez.|Profilo non creato. Controlla le impostazioni IA.|无法生成资料。请检查 AI 设置后重试。|تعذر إعداد الملف. تحقق من إعدادات الذكاء الاصطناعي وحاول مجددًا.|प्रोफ़ाइल नहीं बन सकी। AI सेटिंग जाँचकर फिर प्रयास करें।
Интересы|Interests|Interessen|Intereses|Intérêts|Interessi|兴趣|الاهتمامات|रुचियाँ
Текущие цели|Current goals|Aktuelle Ziele|Objetivos actuales|Objectifs actuels|Obiettivi attuali|当前目标|الأهداف الحالية|वर्तमान लक्ष्य
Хорошо знакомые темы|Familiar topics|Vertraute Themen|Temas conocidos|Sujets familiers|Argomenti familiari|熟悉的主题|مواضيع مألوفة|परिचित विषय
Что хотите изучать|Learning interests|Lerninteressen|Qué quieres aprender|Ce que vous voulez apprendre|Cosa vuoi imparare|想学习的内容|ما تريد تعلمه|क्या सीखना चाहते हैं
Для отдыха|For leisure|Zur Erholung|Para el ocio|Pour les loisirs|Per lo svago|休闲|للترفيه|मनोरंजन के लिए
Создайте профиль с другим AI|Create a profile with another AI|Profil mit einer anderen KI erstellen|Crear perfil con otra IA|Créer un profil avec une autre IA|Crea un profilo con un’altra IA|使用其他 AI 创建资料|أنشئ ملفًا باستخدام ذكاء اصطناعي آخر|अन्य AI से प्रोफ़ाइल बनाएँ
Вернитесь с ответом {provider}|Return with the answer from {provider}|Mit der Antwort von {provider} zurückkehren|Vuelve con la respuesta de {provider}|Revenez avec la réponse de {provider}|Torna con la risposta di {provider}|获取 {provider} 的回答后返回|عُد بإجابة {provider}|{provider} का उत्तर लेकर वापस आएँ
Открыть {provider}|Open {provider}|{provider} öffnen|Abrir {provider}|Ouvrir {provider}|Apri {provider}|打开 {provider}|فتح {provider}|{provider} खोलें
Открыть {provider} снова|Open {provider} again|{provider} erneut öffnen|Abrir {provider} de nuevo|Rouvrir {provider}|Riapri {provider}|再次打开 {provider}|فتح {provider} مجددًا|{provider} फिर खोलें
Используйте запрос ниже в любом AI.|Use the prompt below in any AI.|Die Anfrage unten in einer KI verwenden.|Usa el mensaje de abajo en cualquier IA.|Utilisez la demande ci-dessous dans une IA.|Usa la richiesta qui sotto in un’IA.|将下方提示词用于任意 AI。|استخدم الطلب أدناه مع أي ذكاء اصطناعي.|नीचे का प्रॉम्प्ट किसी भी AI में उपयोग करें।
Скопируйте запрос и отправьте его выбранному AI.|Copy the prompt and send it to your chosen AI.|Anfrage kopieren und an die gewählte KI senden.|Copia el mensaje y envíalo a la IA elegida.|Copiez la demande et envoyez-la à l’IA choisie.|Copia la richiesta e inviala all’IA scelta.|复制提示词并发送给所选 AI。|انسخ الطلب وأرسله إلى الذكاء الاصطناعي المختار.|प्रॉम्प्ट कॉपी करके चुने गए AI को भेजें।
Скопируйте JSON-ответ.|Copy the JSON response.|JSON-Antwort kopieren.|Copia la respuesta JSON.|Copiez la réponse JSON.|Copia la risposta JSON.|复制 JSON 回答。|انسخ إجابة JSON.|JSON उत्तर कॉपी करें।
Вставьте ответ в поле ниже.|Paste the response below.|Antwort unten einfügen.|Pega la respuesta abajo.|Collez la réponse ci-dessous.|Incolla la risposta qui sotto.|在下方粘贴回答。|الصق الإجابة أدناه.|उत्तर नीचे पेस्ट करें।
Копируем запрос и открываем ChatGPT…|Preparing the prompt for ChatGPT…|Anfrage für ChatGPT wird vorbereitet…|Preparando el mensaje para ChatGPT…|Préparation de la demande pour ChatGPT…|Preparazione della richiesta per ChatGPT…|正在准备 ChatGPT 提示词…|جارٍ إعداد الطلب لـ ChatGPT…|ChatGPT के लिए प्रॉम्प्ट तैयार हो रहा है…
Не удалось скопировать автоматически. Покажите запрос и скопируйте его вручную.|Automatic copy failed. Show the prompt and copy it manually.|Kopieren fehlgeschlagen. Anfrage anzeigen und manuell kopieren.|No se pudo copiar. Muestra el mensaje y cópialo manualmente.|Copie impossible. Affichez la demande et copiez-la manuellement.|Copia non riuscita. Mostra la richiesta e copiala manualmente.|自动复制失败。请显示提示词并手动复制。|فشل النسخ التلقائي. اعرض الطلب وانسخه يدويًا.|अपने-आप कॉपी नहीं हुआ। प्रॉम्प्ट दिखाकर मैन्युअल कॉपी करें।
Запрос скопирован, ChatGPT открыт.|Prompt copied; ChatGPT is open.|Anfrage kopiert; ChatGPT ist geöffnet.|Mensaje copiado; ChatGPT abierto.|Demande copiée ; ChatGPT est ouvert.|Richiesta copiata; ChatGPT aperto.|提示词已复制，ChatGPT 已打开。|نُسخ الطلب وفُتح ChatGPT.|प्रॉम्प्ट कॉपी हो गया; ChatGPT खुला है।
Запрос уже скопирован. Откройте ChatGPT кнопкой ниже, вставьте его в поле сообщения и отправьте.|Prompt copied. Open ChatGPT below, paste the prompt and send it.|Anfrage kopiert. ChatGPT unten öffnen, einfügen und senden.|Mensaje copiado. Abre ChatGPT abajo, pégalo y envíalo.|Demande copiée. Ouvrez ChatGPT ci-dessous, collez et envoyez.|Richiesta copiata. Apri ChatGPT, incolla e invia.|提示词已复制。请打开下方 ChatGPT，粘贴并发送。|نُسخ الطلب. افتح ChatGPT أدناه والصقه وأرسله.|प्रॉम्प्ट कॉपी हो गया। नीचे ChatGPT खोलकर पेस्ट करें और भेजें।
Вставьте запрос в {provider} и отправьте его.|Paste the prompt in {provider} and send it.|Anfrage in {provider} einfügen und senden.|Pega el mensaje en {provider} y envíalo.|Collez la demande dans {provider} et envoyez-la.|Incolla la richiesta in {provider} e inviala.|在 {provider} 中粘贴提示词并发送。|الصق الطلب في {provider} وأرسله.|{provider} में प्रॉम्प्ट पेस्ट करके भेजें।
Claude открыт. Покажите запрос и скопируйте его вручную.|Claude is open. Show the prompt and copy it manually.|Claude ist geöffnet. Anfrage anzeigen und kopieren.|Claude abierto. Muestra el mensaje y cópialo.|Claude est ouvert. Affichez et copiez la demande.|Claude è aperto. Mostra e copia la richiesta.|Claude 已打开。请显示提示词并手动复制。|فُتح Claude. اعرض الطلب وانسخه يدويًا.|Claude खुला है। प्रॉम्प्ट दिखाकर कॉपी करें।
Запрос скопирован, Claude открыт в браузере.|Prompt copied; Claude is open in the browser.|Anfrage kopiert; Claude ist im Browser geöffnet.|Mensaje copiado; Claude abierto en el navegador.|Demande copiée ; Claude est ouvert dans le navigateur.|Richiesta copiata; Claude aperto nel browser.|提示词已复制，Claude 已在浏览器打开。|نُسخ الطلب وفُتح Claude في المتصفح.|प्रॉम्प्ट कॉपी हो गया; Claude ब्राउज़र में खुला है।
Claude открыт с подготовленным запросом.|Claude is open with the prepared prompt.|Claude ist mit der vorbereiteten Anfrage geöffnet.|Claude abierto con el mensaje preparado.|Claude est ouvert avec la demande préparée.|Claude è aperto con la richiesta pronta.|Claude 已打开并填入提示词。|فُتح Claude مع الطلب الجاهز.|Claude तैयार प्रॉम्प्ट के साथ खुला है।
Отправьте уже подготовленный запрос.|Send the prepared prompt.|Vorbereitete Anfrage senden.|Envía el mensaje preparado.|Envoyez la demande préparée.|Invia la richiesta pronta.|发送准备好的提示词。|أرسل الطلب الجاهز.|तैयार प्रॉम्प्ट भेजें।
{provider} не открылся автоматически. Откройте сервис снова или используйте запрос вручную.|{provider} did not open. Try again or copy the prompt manually.|{provider} wurde nicht geöffnet. Erneut versuchen oder Anfrage kopieren.|{provider} no se abrió. Reintenta o copia el mensaje.|{provider} ne s’est pas ouvert. Réessayez ou copiez la demande.|{provider} non si è aperto. Riprova o copia la richiesta.|{provider} 未打开。请重试或手动复制提示词。|لم يُفتح {provider}. حاول مجددًا أو انسخ الطلب يدويًا.|{provider} नहीं खुला। फिर प्रयास करें या प्रॉम्प्ट कॉपी करें।
Скрыть запрос|Hide prompt|Anfrage ausblenden|Ocultar mensaje|Masquer la demande|Nascondi richiesta|隐藏提示词|إخفاء الطلب|प्रॉम्प्ट छिपाएँ
Показать запрос вручную|Show prompt|Anfrage anzeigen|Mostrar mensaje|Afficher la demande|Mostra richiesta|显示提示词|عرض الطلب|प्रॉम्प्ट दिखाएँ
Скопировано|Copied|Kopiert|Copiado|Copié|Copiato|已复制|نُسخ|कॉपी हो गया
Выделено — скопируйте|Selected — copy it|Markiert — bitte kopieren|Seleccionado: cópialo|Sélectionné — copiez|Selezionato — copia|已选中，请复制|محدد — انسخه|चयनित — कॉपी करें
Создайте только полезный минимум. Всё можно изменить позже.|Add only useful context. You can edit everything later.|Nur nützlichen Kontext hinzufügen. Alles bleibt änderbar.|Añade solo contexto útil. Podrás editarlo después.|Ajoutez uniquement du contexte utile. Tout reste modifiable.|Aggiungi solo contesto utile. Potrai modificarlo.|只需添加有用信息，之后均可修改。|أضف السياق المفيد فقط. يمكنك تعديله لاحقًا.|केवल उपयोगी संदर्भ जोड़ें। बाद में सब बदल सकते हैं।
Источник: {source}. Это гипотеза — проверьте каждый пункт.|Source: {source}. This is a draft; check each entry.|Quelle: {source}. Entwurf — bitte jeden Eintrag prüfen.|Fuente: {source}. Es un borrador; revisa cada entrada.|Source : {source}. Vérifiez chaque élément de ce brouillon.|Fonte: {source}. È una bozza; verifica ogni voce.|来源：{source}。这是初步资料，请逐项检查。|المصدر: {source}. هذه مسودة؛ راجع كل عنصر.|स्रोत: {source}। यह मसौदा है; हर प्रविष्टि जाँचें।
Широкая экспертиза|General expertise|Allgemeine Fachkenntnisse|Experiencia general|Expertise générale|Competenze generali|总体专长|الخبرة العامة|सामान्य विशेषज्ञता
Подтверждённые знания|Supported knowledge|Belegte Kenntnisse|Conocimientos fundamentados|Connaissances étayées|Conoscenze supportate|有依据的知识|معرفة مدعومة|प्रमाणित ज्ञान
Что сейчас изучаете|Currently learning|Aktuelles Lernen|Aprendizaje actual|Apprentissage actuel|Apprendimento attuale|正在学习|ما تتعلمه الآن|अभी क्या सीख रहे हैं
Неопределённости профиля|Uncertainties|Unsicherheiten|Incertidumbres|Incertitudes|Incertezze|不确定信息|نقاط غير مؤكدة|अनिश्चितताएँ
Обычно малоценные темы|Usually low-value topics|Meist wenig nützliche Themen|Temas poco útiles|Sujets généralement peu utiles|Argomenti poco utili|通常价值较低的主题|مواضيع قليلة الفائدة عادة|आमतौर पर कम उपयोगी विषय
Нет данных|No data|Keine Angaben|Sin datos|Aucune donnée|Nessun dato|暂无数据|لا بيانات|कोई डेटा नहीं
Тема|Topic|Thema|Tema|Sujet|Argomento|主题|الموضوع|विषय
Сила|Strength|Stärke|Intensidad|Intensité|Intensità|强度|القوة|तीव्रता
Уверенность|Confidence|Sicherheit|Confianza|Confiance|Confidenza|置信度|الثقة|विश्वास
Цель|Goal|Ziel|Objetivo|Objectif|Obiettivo|目标|الهدف|लक्ष्य
Приоритет|Priority|Priorität|Prioridad|Priorité|Priorità|优先级|الأولوية|प्राथमिकता
Статус|Status|Status|Estado|Statut|Stato|状态|الحالة|स्थिति
Область|Area|Bereich|Área|Domaine|Ambito|领域|المجال|क्षेत्र
Уровень|Level|Niveau|Nivel|Niveau|Livello|水平|المستوى|स्तर
Что уже известно|What is already known|Bereits bekannt|Lo que ya sabes|Ce qui est déjà connu|Cosa sai già|已知内容|ما هو معروف بالفعل|पहले से ज्ञात बातें
Основание|Evidence|Grundlage|Fundamento|Fondement|Fondamento|依据|الأساس|आधार
Фокус|Focus|Fokus|Enfoque|Priorité actuelle|Focus|重点|التركيز|केंद्र
Что неизвестно|What is unknown|Unbekanntes|Lo que se desconoce|Ce qui est inconnu|Cosa non è noto|未知内容|ما هو غير معروف|अज्ञात बातें
Предпочтения по материалам|Content preferences|Inhaltspräferenzen|Preferencias de contenido|Préférences de contenu|Preferenze sui contenuti|内容偏好|تفضيلات المحتوى|सामग्री की पसंद
Глубина|Depth|Tiefe|Profundidad|Profondeur|Profondità|深度|العمق|गहराई
Новизна|Novelty|Neuheit|Novedad|Nouveauté|Novità|新颖性|الجِدّة|नवीनता
Форматы через запятую|Formats, separated by commas|Formate, durch Kommas getrennt|Formatos separados por comas|Formats séparés par des virgules|Formati separati da virgole|格式，用逗号分隔|صيغ مفصولة بفواصل|प्रारूप, कॉमा से अलग करें
Избегать повторов уже известного|Avoid familiar repetition|Bekannte Wiederholungen vermeiden|Evitar repeticiones conocidas|Éviter les répétitions connues|Evita ripetizioni note|避免重复已知内容|تجنب تكرار المعروف|ज्ञात बातें दोहराने से बचें
Удалить|Delete|Löschen|Eliminar|Supprimer|Elimina|删除|حذف|हटाएँ
Предпочтения для отдыха|Leisure preferences|Freizeitpräferenzen|Preferencias de ocio|Préférences de loisir|Preferenze di svago|休闲偏好|تفضيلات الترفيه|मनोरंजन की पसंद
Недостаточно данных — в режиме отдыха профиль не будет ничего додумывать.|Not enough evidence. No leisure preferences will be assumed.|Zu wenig Daten. Freizeitpräferenzen werden nicht erfunden.|Sin evidencia suficiente; no se asumirán preferencias de ocio.|Données insuffisantes. Aucune préférence ne sera supposée.|Dati insufficienti. Nessuna preferenza verrà inventata.|依据不足，不会推测休闲偏好。|الأدلة غير كافية. لن تُفترض تفضيلات ترفيهية.|प्रमाण पर्याप्त नहीं हैं। मनोरंजन की पसंद नहीं मानी जाएगी।
Тип|Type|Typ|Tipo|Type|Tipo|类别|النوع|प्रकार
Что именно|Details|Details|Detalles|Détails|Dettagli|具体内容|التفاصيل|विवरण
Насколько нравится|Preference strength|Präferenzstärke|Intensidad de preferencia|Intensité de préférence|Intensità della preferenza|喜好程度|قوة التفضيل|पसंद का स्तर
Почему так решено|Reason for this assessment|Begründung|Motivo de esta valoración|Raison de cette évaluation|Motivo della valutazione|判断依据|سبب هذا التقييم|इस आकलन का कारण
Новое или знакомое|New or familiar|Neues oder Vertrautes|Nuevo o familiar|Nouveau ou familier|Nuovo o familiare|新内容或熟悉内容|جديد أم مألوف|नया या परिचित
Предпочитаемое усилие|Preferred effort|Gewünschter Aufwand|Esfuerzo preferido|Effort préféré|Impegno preferito|偏好的投入程度|الجهد المفضل|पसंदीदा प्रयास
Уверенность профиля|Profile confidence|Profilsicherheit|Confianza del perfil|Confiance du profil|Confidenza del profilo|资料置信度|الثقة في الملف|प्रोफ़ाइल का विश्वास स्तर
Добавлено пользователем|Added by you|Von Ihnen hinzugefügt|Añadido por ti|Ajouté par vous|Aggiunto da te|用户添加|أضفته أنت|आपने जोड़ा
Оставить текущее|Keep current|Aktuelles behalten|Mantener actual|Conserver l’actuel|Mantieni attuale|保留当前|الاحتفاظ بالحالي|वर्तमान रखें
Использовать импорт|Use imported|Importiertes verwenden|Usar importado|Utiliser l’import|Usa importato|使用导入内容|استخدام المستورد|आयातित उपयोग करें
Удалить весь локальный личный профиль?|Delete your entire local personal profile?|Gesamtes lokales Profil löschen?|¿Eliminar todo tu perfil personal local?|Supprimer tout votre profil personnel local ?|Eliminare tutto il profilo personale locale?|删除全部本地个人资料？|حذف ملفك الشخصي المحلي بالكامل؟|पूरी स्थानीय व्यक्तिगत प्रोफ़ाइल हटाएँ?
Точнее под вас|More personal|Persönlicher|Más personal|Plus personnel|Più personale|更适合你|أكثر تخصيصًا|अधिक व्यक्तिगत
Улучшить персонализацию|Improve personalization|Personalisierung verbessern|Mejorar personalización|Améliorer la personnalisation|Migliora personalizzazione|改进个性化|تحسين التخصيص|निजीकरण सुधारें
Быстрая настройка|Quick setup|Schnelleinrichtung|Configuración rápida|Configuration rapide|Configurazione rapida|快速设置|إعداد سريع|त्वरित सेटअप
Три ответа · около 30 секунд|Three answers · about 30 seconds|Drei Antworten · etwa 30 Sekunden|Tres respuestas · unos 30 segundos|Trois réponses · environ 30 secondes|Tre risposte · circa 30 secondi|三个回答 · 约 30 秒|ثلاث إجابات · نحو 30 ثانية|तीन उत्तर · लगभग 30 सेकंड
Пусть {provider} представит меня|Let {provider} introduce me|Profil mit {provider} erstellen|Que {provider} me presente|Laisser {provider} me présenter|Lascia che {provider} mi presenti|让 {provider} 介绍我|دع {provider} يعرّفني|{provider} से मेरा परिचय लें
Использовать уже накопленный контекст|Use existing context|Vorhandenen Kontext nutzen|Usar contexto existente|Utiliser le contexte existant|Usa il contesto esistente|使用已有背景|استخدام السياق الموجود|मौजूदा संदर्भ उपयोग करें
УЧЕСТЬ МОЮ ИСТОРИЮ|USE MY HISTORY|MEINEN VERLAUF NUTZEN|USAR MI HISTORIAL|UTILISER MON HISTORIQUE|USA LA MIA CRONOLOGIA|使用浏览记录|استخدام سجلي|मेरा इतिहास उपयोग करें
Настроить историю браузера|Configure browser history|Browserverlauf einrichten|Configurar historial|Configurer l’historique|Configura cronologia|设置浏览记录|إعداد سجل المتصفح|ब्राउज़र इतिहास सेट करें
Открыть настройки этого источника|Open source settings|Quelleneinstellungen öffnen|Abrir ajustes de la fuente|Ouvrir les réglages de la source|Apri impostazioni della fonte|打开来源设置|فتح إعدادات المصدر|स्रोत की सेटिंग खोलें
УЧЕСТЬ СОХРАНЁННОЕ|USE SAVED MATERIAL|GESPEICHERTES NUTZEN|USAR LO GUARDADO|UTILISER LE CONTENU ENREGISTRÉ|USA I CONTENUTI SALVATI|使用已保存内容|استخدام المواد المحفوظة|सहेजी सामग्री उपयोग करें
Выделения и заметки для оценки новизны|Highlights and notes for novelty|Markierungen und Notizen für Neuheit|Subrayados y notas para la novedad|Passages et notes pour la nouveauté|Evidenziazioni e note per la novità|用摘录和笔记评估新颖性|إبرازات وملاحظات لتقييم الجِدّة|नवीनता के लिए हाइलाइट और नोट
Не подключён|Not connected|Nicht verbunden|No conectado|Non connecté|Non connesso|未连接|غير متصل|कनेक्ट नहीं है
Собственные заметки для оценки новизны|Your notes for novelty|Eigene Notizen für Neuheit|Tus notas para la novedad|Vos notes pour la nouveauté|Le tue note per la novità|用个人笔记评估新颖性|ملاحظاتك لتقييم الجِدّة|नवीनता के लिए आपके नोट
Выбранные страницы для оценки новизны|Selected pages for novelty|Ausgewählte Seiten für Neuheit|Páginas elegidas para la novedad|Pages choisies pour la nouveauté|Pagine scelte per la novità|用所选页面评估新颖性|صفحات مختارة لتقييم الجِدّة|नवीनता के लिए चुने पृष्ठ
Настроить вручную|Set up manually|Manuell einrichten|Configurar manualmente|Configurer manuellement|Configura manualmente|手动设置|إعداد يدوي|मैन्युअल सेट करें
Не сейчас|Not now|Nicht jetzt|Ahora no|Pas maintenant|Non ora|暂不|ليس الآن|अभी नहीं
Attention не получает доступ к истории ChatGPT или Claude. Вы передаёте только готовый профиль, который хранится локально.|Attention cannot access your ChatGPT or Claude history. You import only the finished profile, stored locally.|Attention hat keinen Zugriff auf Ihren ChatGPT- oder Claude-Verlauf. Nur das fertige Profil wird lokal importiert.|Attention no accede a tu historial de ChatGPT o Claude. Solo importas el perfil terminado, guardado localmente.|Attention n’accède pas à votre historique ChatGPT ou Claude. Vous importez uniquement le profil final, conservé localement.|Attention non accede alla cronologia ChatGPT o Claude. Importi solo il profilo pronto, salvato localmente.|Attention 无法访问 ChatGPT 或 Claude 历史。你仅导入生成的资料，并保存在本地。|لا يصل Attention إلى سجل ChatGPT أو Claude. تستورد الملف الجاهز فقط ويُحفظ محليًا.|Attention आपके ChatGPT या Claude इतिहास को नहीं पढ़ता। केवल तैयार प्रोफ़ाइल आयात होती है और स्थानीय रहती है।
← Способы настройки|← Setup options|← Einrichtungsmöglichkeiten|← Opciones de configuración|← Options de configuration|← Opzioni di configurazione|← 设置方式|← خيارات الإعداد|← सेटअप विकल्प
Около 30 секунд|About 30 seconds|Etwa 30 Sekunden|Unos 30 segundos|Environ 30 secondes|Circa 30 secondi|约 30 秒|نحو 30 ثانية|लगभग 30 सेकंड
Расскажите о себе обычными словами|Describe yourself in your own words|Beschreiben Sie sich in eigenen Worten|Descríbete con tus palabras|Décrivez-vous avec vos mots|Descriviti con parole tue|用自己的话介绍自己|صف نفسك بكلماتك|अपने शब्दों में अपने बारे में बताएँ
AI превратит ответы в структурированный локальный профиль. JSON вы не увидите.|AI structures your answers into a local profile for you to review.|KI strukturiert Ihre Antworten zu einem lokalen Profil zur Prüfung.|La IA organiza tus respuestas en un perfil local para revisar.|L’IA structure vos réponses en un profil local à vérifier.|L’IA organizza le risposte in un profilo locale da verificare.|AI 将回答整理为本地资料，供你检查。|ينظم الذكاء الاصطناعي إجاباتك في ملف محلي تراجعه.|AI आपके उत्तरों से स्थानीय प्रोफ़ाइल बनाएगा जिसे आप जाँचेंगे।
Что вы обычно хотите получать от интернета?|What do you usually want from the internet?|Was möchten Sie gewöhnlich im Internet finden?|¿Qué buscas normalmente en internet?|Que recherchez-vous habituellement sur internet ?|Cosa cerchi di solito su internet?|你通常想从互联网获取什么？|ماذا تريد عادة من الإنترنت؟|आप इंटरनेट से आमतौर पर क्या चाहते हैं?
Какие темы вы уже знаете хорошо?|Which topics do you already know well?|Welche Themen kennen Sie schon gut?|¿Qué temas conoces bien?|Quels sujets connaissez-vous déjà bien ?|Quali argomenti conosci già bene?|你已经熟悉哪些主题？|ما المواضيع التي تعرفها جيدًا؟|कौन से विषय आप पहले से अच्छी तरह जानते हैं?
Что вам нравится вне продуктивных задач?|What do you enjoy outside work and study?|Was genießen Sie außerhalb von Arbeit und Lernen?|¿Qué disfrutas fuera del trabajo y el estudio?|Qu’aimez-vous en dehors du travail et des études ?|Cosa ti piace oltre al lavoro e allo studio?|工作和学习之外，你喜欢什么？|بماذا تستمتع خارج العمل والدراسة؟|काम और पढ़ाई के अलावा आपको क्या पसंद है?
Подготовить профиль|Prepare profile|Profil erstellen|Preparar perfil|Préparer le profil|Prepara profilo|生成资料|إعداد الملف|प्रोफ़ाइल बनाएँ
Для этого нужен подключённый AI-анализатор. Ответы отправляются выбранной модели один раз; готовый профиль хранится локально.|Requires connected AI. Your answers are sent once to the selected model; the resulting profile stays local.|Erfordert verbundene KI. Antworten werden einmal an das gewählte Modell gesendet; das Profil bleibt lokal.|Requiere IA conectada. Las respuestas se envían una vez al modelo elegido; el perfil queda local.|Nécessite une IA connectée. Les réponses sont envoyées une fois au modèle choisi ; le profil reste local.|Richiede IA connessa. Le risposte sono inviate una volta al modello scelto; il profilo resta locale.|需要连接 AI。回答会发送给所选模型一次，生成的资料保存在本地。|يتطلب ذكاء اصطناعيًا متصلًا. تُرسل الإجابات مرة للنموذج المختار؛ ويبقى الملف محليًا.|AI कनेक्शन आवश्यक है। उत्तर एक बार चुने मॉडल को भेजे जाते हैं; तैयार प्रोफ़ाइल स्थानीय रहती है।
← Изменить ответы|← Edit answers|← Antworten ändern|← Editar respuestas|← Modifier les réponses|← Modifica risposte|← 修改回答|← تعديل الإجابات|← उत्तर बदलें
Проверьте одним взглядом|Review the result|Ergebnis prüfen|Revisa el resultado|Vérifiez le résultat|Verifica il risultato|检查结果|راجع النتيجة|परिणाम जाँचें
Вот что понял Attention|What Attention understood|Was Attention verstanden hat|Lo que entendió Attention|Ce qu’Attention a compris|Cosa ha capito Attention|Attention 的理解|ما فهمه Attention|Attention ने क्या समझा
Не сохранять|Do not save|Nicht speichern|No guardar|Ne pas enregistrer|Non salvare|不保存|عدم الحفظ|न सहेजें
Всё верно|Looks right|Stimmt so|Correcto|C’est correct|È corretto|确认正确|صحيح|सही है
← Выбрать другой AI|← Choose another AI|← Andere KI wählen|← Elegir otra IA|← Choisir une autre IA|← Scegli un’altra IA|← 选择其他 AI|← اختر ذكاء اصطناعيًا آخر|← अन्य AI चुनें
Ожидание ответа AI|Waiting for the AI response|Warten auf KI-Antwort|Esperando respuesta de IA|En attente de la réponse IA|In attesa della risposta IA|等待 AI 回答|انتظار إجابة الذكاء الاصطناعي|AI उत्तर की प्रतीक्षा
Импорт контекста|Import context|Kontext importieren|Importar contexto|Importer le contexte|Importa contesto|导入背景|استيراد السياق|संदर्भ आयात करें
Открыть AI снова|Open AI again|KI erneut öffnen|Abrir IA de nuevo|Rouvrir l’IA|Riapri IA|再次打开 AI|فتح الذكاء الاصطناعي مجددًا|AI फिर खोलें
Claude не открылся? Открыть в браузере|Claude did not open? Open in browser|Claude nicht geöffnet? Im Browser öffnen|¿Claude no se abrió? Abrir en navegador|Claude ne s’ouvre pas ? Ouvrir dans le navigateur|Claude non si apre? Apri nel browser|Claude 未打开？在浏览器中打开|لم يُفتح Claude؟ افتحه في المتصفح|Claude नहीं खुला? ब्राउज़र में खोलें
Запрос для экспорта|Export prompt|Exportanfrage|Mensaje de exportación|Demande d’export|Richiesta di esportazione|导出提示词|طلب التصدير|निर्यात प्रॉम्प्ट
Скопировать запрос|Copy prompt|Anfrage kopieren|Copiar mensaje|Copier la demande|Copia richiesta|复制提示词|نسخ الطلب|प्रॉम्प्ट कॉपी करें
Ответ AI в формате JSON|AI response in JSON|KI-Antwort als JSON|Respuesta IA en JSON|Réponse IA au format JSON|Risposta IA in JSON|AI 的 JSON 回答|إجابة الذكاء الاصطناعي بصيغة JSON|JSON में AI उत्तर
Проверить и просмотреть|Validate and review|Prüfen und ansehen|Validar y revisar|Valider et vérifier|Convalida e verifica|验证并查看|تحقق وراجع|सत्यापित कर जाँचें
Attention не читает переписки и не подключается к аккаунту AI. Ответ вставляете вы сами.|Attention does not read chats or connect to your AI account. You paste the response yourself.|Attention liest keine Chats und verbindet sich nicht mit Ihrem KI-Konto. Sie fügen die Antwort selbst ein.|Attention no lee chats ni accede a tu cuenta de IA. Tú pegas la respuesta.|Attention ne lit pas vos échanges et ne se connecte pas à votre compte IA. Vous collez la réponse vous-même.|Attention non legge chat né accede al tuo account IA. Incolli tu la risposta.|Attention 不读取聊天，也不连接 AI 账户。回答由你手动粘贴。|لا يقرأ Attention المحادثات ولا يتصل بحسابك. تلصق الإجابة بنفسك.|Attention चैट नहीं पढ़ता और AI खाते से नहीं जुड़ता। उत्तर आप खुद पेस्ट करते हैं।
Проверка перед сохранением|Review before saving|Vor dem Speichern prüfen|Revisar antes de guardar|Vérifier avant d’enregistrer|Verifica prima di salvare|保存前检查|المراجعة قبل الحفظ|सहेजने से पहले जाँचें
Ваш начальный профиль|Your initial profile|Ihr erstes Profil|Tu perfil inicial|Votre profil initial|Il tuo profilo iniziale|初始个人资料|ملفك الأولي|आपकी प्रारंभिक प्रोफ़ाइल
Отменить импорт|Cancel import|Import abbrechen|Cancelar importación|Annuler l’import|Annulla importazione|取消导入|إلغاء الاستيراد|आयात रद्द करें
Использовать этот профиль|Use this profile|Dieses Profil verwenden|Usar este perfil|Utiliser ce profil|Usa questo profilo|使用此资料|استخدام هذا الملف|यह प्रोफ़ाइल उपयोग करें
Нужен ваш выбор|Your choice is needed|Ihre Auswahl ist nötig|Se necesita tu elección|Votre choix est nécessaire|Serve la tua scelta|需要你的选择|اختيارك مطلوب|आपका चयन आवश्यक है
Разрешите противоречия|Resolve differences|Unterschiede klären|Resolver diferencias|Résoudre les différences|Risolvi le differenze|解决差异|حل الاختلافات|अंतर सुलझाएँ
Совпадающие и новые данные уже объединены. Для этих пунктов версии различаются, поэтому Attention не выбирает автоматически.|Matching and new entries are merged. Choose which version to keep for the differences below.|Übereinstimmende und neue Einträge sind zusammengeführt. Bei Unterschieden wählen Sie die Version.|Las entradas coincidentes y nuevas están combinadas. Elige una versión para las diferencias.|Les éléments concordants et nouveaux sont fusionnés. Choisissez une version pour les différences.|Le voci uguali e nuove sono unite. Scegli la versione per le differenze.|相同和新增内容已合并。请选择下方差异项保留的版本。|دُمجت العناصر المتطابقة والجديدة. اختر النسخة التي تريد الاحتفاظ بها للاختلافات أدناه.|मिलती और नई प्रविष्टियाँ जुड़ गई हैं। नीचे अंतरों के लिए संस्करण चुनें।
Назад к проверке|Back to review|Zurück zur Prüfung|Volver a revisar|Retour à la vérification|Torna alla verifica|返回检查|العودة للمراجعة|जाँच पर लौटें
Сохранить выбор|Save choices|Auswahl speichern|Guardar elecciones|Enregistrer les choix|Salva scelte|保存选择|حفظ الاختيارات|चयन सहेजें
Например: слежу за AI и экономикой, ищу идеи для работы|For example: AI, economics, ideas for work|Zum Beispiel: KI, Wirtschaft, Ideen für die Arbeit|Por ejemplo: IA, economía, ideas para el trabajo|Par exemple : IA, économie, idées pour le travail|Per esempio: IA, economia, idee per il lavoro|例如：关注 AI、经济，寻找工作思路|مثلًا: الذكاء الاصطناعي والاقتصاد وأفكار للعمل|जैसे: AI, अर्थशास्त्र, काम के लिए विचार
Например: хорошо знаю экономику, но не являюсь ML-инженером|For example: familiar with economics, new to machine learning|Zum Beispiel: Wirtschaft vertraut, maschinelles Lernen neu|Por ejemplo: conozco economía, empiezo con aprendizaje automático|Par exemple : économie connue, début en apprentissage automatique|Per esempio: conosco l’economia, sono nuovo al machine learning|例如：熟悉经济学，刚接触机器学习|مثلًا: أعرف الاقتصاد، وأتعلم تعلم الآلة|जैसे: अर्थशास्त्र जानता हूँ, मशीन लर्निंग में नया हूँ
Например: исторические документалки, фантастика и научные видео|For example: history documentaries, fiction, science videos|Zum Beispiel: Geschichtsdokus, Romane, Wissenschaftsvideos|Por ejemplo: documentales históricos, ficción, vídeos científicos|Par exemple : documentaires historiques, fiction, vidéos scientifiques|Per esempio: documentari storici, narrativa, video scientifici|例如：历史纪录片、科幻和科学视频|مثلًا: وثائقيات تاريخية وروايات وفيديوهات علمية|जैसे: इतिहास वृत्तचित्र, कथा साहित्य, विज्ञान वीडियो
Вставьте объект с "schema_version": "2.0"|Paste an object with "schema_version": "2.0"|Objekt mit "schema_version": "2.0" einfügen|Pega un objeto con "schema_version": "2.0"|Collez un objet avec "schema_version": "2.0"|Incolla un oggetto con "schema_version": "2.0"|粘贴包含 "schema_version": "2.0" 的对象|الصق كائنًا يحتوي "schema_version": "2.0"|"schema_version": "2.0" वाला ऑब्जेक्ट पेस्ट करें
Добавить пункт|Add entry|Eintrag hinzufügen|Añadir entrada|Ajouter un élément|Aggiungi voce|添加项目|إضافة عنصر|प्रविष्टि जोड़ें
Профиль не сохранён: данные были удалены. Начните настройку заново.|Profile not saved: data was deleted. Start setup again.|Profil nicht gespeichert: Daten gelöscht. Einrichtung neu starten.|Perfil no guardado: datos eliminados. Empieza de nuevo.|Profil non enregistré : données supprimées. Recommencez.|Profilo non salvato: dati eliminati. Ricomincia.|资料未保存：数据已删除，请重新设置。|لم يُحفظ الملف: حُذفت البيانات. ابدأ الإعداد مجددًا.|प्रोफ़ाइल नहीं सहेजी गई: डेटा हटा दिया गया। सेटअप फिर शुरू करें।
Проверьте формат JSON и обязательные поля профиля.|Check the JSON format and required profile fields.|JSON-Format und Pflichtfelder prüfen.|Revisa el JSON y los campos obligatorios.|Vérifiez le JSON et les champs obligatoires.|Controlla JSON e campi obbligatori.|请检查 JSON 格式和必填字段。|تحقق من صيغة JSON والحقول المطلوبة.|JSON प्रारूप और आवश्यक फ़ील्ड जाँचें।
← Назад|← Back|← Zurück|← Atrás|← Retour|← Indietro|← 返回|← رجوع|← वापस
Дополнительный источник|Optional source|Optionale Quelle|Fuente opcional|Source facultative|Fonte facoltativa|可选来源|مصدر اختياري|वैकल्पिक स्रोत
Учесть недавнюю историю|Use recent history|Letzten Verlauf einbeziehen|Usar historial reciente|Utiliser l’historique récent|Usa cronologia recente|参考近期历史|استخدام السجل الحديث|हाल का इतिहास उपयोग करें
Attention локально найдёт темы и источники, которые вам уже встречались. Посещение страницы не считается чтением, знанием или одобрением.|Attention finds familiar topics and sources locally. A visit does not prove reading, knowledge, or approval.|Attention findet bekannte Themen und Quellen lokal. Ein Besuch belegt weder Lesen noch Wissen oder Zustimmung.|Attention detecta temas y fuentes conocidos localmente. Una visita no demuestra lectura, conocimiento ni aprobación.|Attention repère localement les sujets et sources déjà rencontrés. Une visite ne prouve ni lecture, ni connaissance, ni approbation.|Attention trova localmente temi e fonti già incontrati. Una visita non dimostra lettura, conoscenza o approvazione.|Attention 在本地识别见过的主题和来源。访问不代表已阅读、了解或认同。|يحدد Attention المواضيع والمصادر المألوفة محليًا. الزيارة لا تثبت القراءة أو المعرفة أو الموافقة.|Attention परिचित विषय और स्रोत स्थानीय रूप से ढूँढता है। विज़िट पढ़ने, ज्ञान या सहमति का प्रमाण नहीं है।
точнее замечать уже встречавшиеся страницы;|Recognize previously visited pages;|Bereits besuchte Seiten erkennen;|Reconocer páginas ya visitadas;|Reconnaître les pages déjà visitées ;|Riconosci pagine già visitate;|识别之前访问过的页面；|التعرف على الصفحات التي زرتها؛|पहले देखे गए पृष्ठ पहचानें;
видеть повторяющиеся темы и предпочитаемые источники;|Identify recurring topics and sources;|Wiederkehrende Themen und Quellen erkennen;|Identificar temas y fuentes recurrentes;|Repérer les sujets et sources récurrents ;|Identifica temi e fonti ricorrenti;|识别反复出现的主题和来源；|تحديد المواضيع والمصادر المتكررة؛|बार-बार आने वाले विषय और स्रोत पहचानें;
осторожнее оценивать релевантность и новизну.|Estimate relevance and novelty more carefully.|Relevanz und Neuheit vorsichtiger einschätzen.|Estimar relevancia y novedad con más cautela.|Estimer la pertinence et la nouveauté avec prudence.|Valuta pertinenza e novità con più cautela.|更谨慎地评估相关性和新颖性。|تقدير الصلة والجِدة بحذر أكبر.|प्रासंगिकता और नवीनता का अधिक सावधानी से अनुमान लगाएँ।
За какой период?|Time range|Zeitraum|Periodo|Période|Periodo|时间范围|الفترة الزمنية|समय अवधि
{count} дней|{count} days|{count} Tage|{count} días|{count} jours|{count} giorni|{count} 天|{count} أيام|{count} दिन
Разрешить и обработать последние {count} дней|Allow and process the last {count} days|Letzte {count} Tage erlauben und auswerten|Permitir y procesar los últimos {count} días|Autoriser et traiter les {count} derniers jours|Consenti ed elabora gli ultimi {count} giorni|授权并处理最近 {count} 天|السماح ومعالجة آخر {count} أيام|अनुमति दें और पिछले {count} दिन संसाधित करें
После нажатия Chrome запросит одно временное разрешение на чтение истории.|Chrome will ask for temporary permission to read history.|Chrome fragt nach einer vorübergehenden Erlaubnis zum Lesen des Verlaufs.|Chrome pedirá permiso temporal para leer el historial.|Chrome demandera un accès temporaire à l’historique.|Chrome chiederà il permesso temporaneo di leggere la cronologia.|Chrome 将请求临时读取历史记录的权限。|سيطلب Chrome إذنًا مؤقتًا لقراءة السجل.|Chrome इतिहास पढ़ने की अस्थायी अनुमति माँगेगा।
История обработана локально|History processed locally|Verlauf lokal verarbeitet|Historial procesado localmente|Historique traité localement|Cronologia elaborata localmente|历史记录已在本地处理|عولج السجل محليًا|इतिहास स्थानीय रूप से संसाधित हुआ
Удалить сигналы истории|Delete history signals|Verlaufssignale löschen|Eliminar señales del historial|Supprimer les signaux de l’historique|Elimina segnali della cronologia|删除历史记录信号|حذف إشارات السجل|इतिहास संकेत हटाएँ
Страницы не загружаются, AI не вызывается. Сырые URL и заголовки не сохраняются. После обработки разрешение отзывается автоматически.|No pages are fetched and no AI is called. Raw URLs and titles are not stored. Permission is revoked after processing.|Keine Seitenabrufe, keine KI. Rohe URLs und Titel werden nicht gespeichert. Die Erlaubnis wird danach widerrufen.|No se cargan páginas ni se llama a IA. No se guardan URL ni títulos originales. El permiso se revoca al terminar.|Aucune page chargée, aucun appel IA. Les URL et titres bruts ne sont pas conservés. L’accès est révoqué après traitement.|Nessuna pagina scaricata né chiamata AI. URL e titoli grezzi non vengono salvati. Il permesso viene revocato al termine.|不加载页面，不调用 AI，不保存原始 URL 和标题。处理后自动撤销权限。|لا تُحمّل صفحات ولا يُستدعى الذكاء الاصطناعي. لا تُحفظ الروابط والعناوين الأصلية. يُلغى الإذن بعد المعالجة.|कोई पृष्ठ नहीं लोड होता, AI नहीं चलता। मूल URL और शीर्षक नहीं सहेजे जाते। बाद में अनुमति हटती है।
Использовано {pages} страниц и {visits} посещений за {days} дней. Исключено адресов: {excluded}.|Used {pages} pages and {visits} visits over {days} days. Excluded addresses: {excluded}.|{pages} Seiten und {visits} Besuche in {days} Tagen. Ausgeschlossene Adressen: {excluded}.|Se usaron {pages} páginas y {visits} visitas en {days} días. Direcciones excluidas: {excluded}.|{pages} pages et {visits} visites sur {days} jours. Adresses exclues : {excluded}.|Usate {pages} pagine e {visits} visite in {days} giorni. Indirizzi esclusi: {excluded}.|参考了 {days} 天内的 {pages} 个页面和 {visits} 次访问，排除 {excluded} 个地址。|استُخدمت {pages} صفحة و{visits} زيارة خلال {days} يومًا. العناوين المستبعدة: {excluded}.|{days} दिनों में {pages} पृष्ठ और {visits} विज़िट उपयोग हुए। छोड़े गए पते: {excluded}।
Временное разрешение не удалось отозвать. Удалите сигналы, чтобы повторить отзыв.|Temporary permission could not be revoked. Delete signals to retry.|Temporäre Erlaubnis konnte nicht widerrufen werden. Signale löschen, um es erneut zu versuchen.|No se pudo revocar el permiso temporal. Elimina las señales para reintentar.|Impossible de révoquer l’accès temporaire. Supprimez les signaux pour réessayer.|Impossibile revocare il permesso temporaneo. Elimina i segnali per riprovare.|临时权限撤销失败。请删除信号以重试。|تعذر إلغاء الإذن المؤقت. احذف الإشارات للمحاولة مجددًا.|अस्थायी अनुमति नहीं हट सकी। फिर प्रयास करने के लिए संकेत हटाएँ।
Проверяем разрешение Chrome…|Checking Chrome permission…|Chrome-Erlaubnis wird geprüft…|Comprobando permiso de Chrome…|Vérification de l’accès Chrome…|Verifica permesso Chrome…|正在检查 Chrome 权限…|جارٍ التحقق من إذن Chrome…|Chrome अनुमति जाँच रहे हैं…
Доступ не предоставлен. История не читалась и ничего не изменилось.|Permission not granted. History was not read and nothing changed.|Keine Erlaubnis. Verlauf wurde nicht gelesen und nichts geändert.|Permiso no concedido. No se leyó el historial ni se cambió nada.|Accès non accordé. L’historique n’a pas été lu, rien n’a changé.|Permesso negato. Cronologia non letta, nessuna modifica.|未获得授权。未读取历史，也未做任何更改。|لم يُمنح الإذن. لم يُقرأ السجل ولم يتغير شيء.|अनुमति नहीं मिली। इतिहास नहीं पढ़ा गया और कुछ नहीं बदला।
Обрабатываем историю локально…|Processing history locally…|Verlauf wird lokal verarbeitet…|Procesando historial localmente…|Traitement local de l’historique…|Elaborazione locale della cronologia…|正在本地处理历史记录…|جارٍ معالجة السجل محليًا…|इतिहास स्थानीय रूप से संसाधित हो रहा है…
Готово. Сигналы сохранены локально; доступ Chrome не удалось отозвать автоматически.|Done. Signals saved locally; Chrome permission could not be revoked automatically.|Fertig. Signale lokal gespeichert; Chrome-Erlaubnis konnte nicht automatisch widerrufen werden.|Listo. Señales guardadas localmente; no se pudo revocar el permiso de Chrome automáticamente.|Terminé. Signaux conservés localement ; accès Chrome non révoqué automatiquement.|Fatto. Segnali salvati localmente; permesso Chrome non revocato automaticamente.|完成。信号已保存在本地，但未能自动撤销 Chrome 权限。|تم الحفظ محليًا؛ تعذر إلغاء إذن Chrome تلقائيًا.|पूरा। संकेत स्थानीय रूप से सहेजे गए; Chrome अनुमति अपने आप नहीं हट सकी।
Готово. Сигналы сохранены локально, временный доступ к истории отозван.|Done. Signals saved locally and temporary history access revoked.|Fertig. Signale lokal gespeichert, temporärer Zugriff widerrufen.|Listo. Señales guardadas localmente y acceso temporal revocado.|Terminé. Signaux conservés localement, accès temporaire révoqué.|Fatto. Segnali salvati localmente, accesso temporaneo revocato.|完成。信号已保存在本地，临时历史权限已撤销。|تم حفظ الإشارات محليًا وإلغاء الوصول المؤقت للسجل.|पूरा। संकेत स्थानीय रूप से सहेजे गए और अस्थायी अनुमति हटा दी गई।
Не удалось обработать историю. Временное разрешение будет отозвано.|Could not process history. Temporary permission will be revoked.|Verlauf konnte nicht verarbeitet werden. Temporäre Erlaubnis wird widerrufen.|No se pudo procesar el historial. Se revocará el permiso temporal.|Impossible de traiter l’historique. L’accès temporaire sera révoqué.|Impossibile elaborare la cronologia. Il permesso temporaneo sarà revocato.|历史处理失败。将撤销临时权限。|تعذرت معالجة السجل. سيُلغى الإذن المؤقت.|इतिहास संसाधित नहीं हो सका। अस्थायी अनुमति हटाई जाएगी।
Сигналы истории удалены, разрешение отозвано.|History signals deleted and permission revoked.|Verlaufssignale gelöscht, Erlaubnis widerrufen.|Señales del historial eliminadas y permiso revocado.|Signaux de l’historique supprimés, accès révoqué.|Segnali eliminati e permesso revocato.|已删除历史信号并撤销权限。|حُذفت إشارات السجل وأُلغي الإذن.|इतिहास संकेत हटाए गए और अनुमति हटा दी गई।
`;

export const PROFILE_TRANSLATIONS = new Map<
  string,
  Readonly<Record<UiLanguage, string>>
>(
  rows
    .trim()
    .split('\n')
    .map((row) => {
      const values = row.split('|');
      if (values.length !== languages.length)
        throw new Error('Incomplete profile translation');
      return [
        values[0]!,
        Object.fromEntries(
          languages.map((language, index) => [language, values[index]!]),
        ) as Record<UiLanguage, string>,
      ];
    }),
);

const aliases: Record<string, string> = {
  'другим AI': 'Другой AI',
  'Создать профиль с другим AI': 'Создайте профиль с другим AI',
  'Тема интереса': 'Тема',
  'Текущая цель': 'Цель',
  'Приоритет цели': 'Приоритет',
  'Статус цели': 'Статус',
  'Область экспертизы': 'Область',
  'Уровень экспертизы': 'Уровень',
  'Малоценная тема': 'Обычно малоценные темы',
  'Область знания': 'Область',
  'Известное утверждение': 'Что уже известно',
  'Тип основания знания': 'Основание',
  'Изучаемая область': 'Область',
  'Текущий фокус': 'Фокус',
  'Неопределённая область': 'Область',
  Неопределённость: 'Неопределённости профиля',
  'Не указаны': 'Нет данных',
  'Предпочитаемая глубина': 'Глубина',
  'Предпочитаемая новизна': 'Новизна',
  'Предпочитаемые форматы': 'Форматы через запятую',
  'Тип предпочтения для отдыха': 'Тип',
  'Предпочтение для отдыха': 'Предпочтения для отдыха',
  'Сила предпочтения': 'Насколько нравится',
  'Основание предпочтения': 'Основание',
  'Новизна для отдыха': 'Новое или знакомое',
  'Предпочитаемое усилие для отдыха': 'Предпочитаемое усилие',
  'Обычная сессия, минут': 'Обычная длительность отдыха в минутах',
  'Скопируйте полученный JSON-ответ.': 'Скопируйте JSON-ответ.',
  'Скопируйте его JSON-ответ.': 'Скопируйте JSON-ответ.',
  'Вернитесь сюда и вставьте ответ ниже.': 'Вставьте ответ в поле ниже.',
  'Отправьте запрос выбранному AI.':
    'Скопируйте запрос и отправьте его выбранному AI.',
  Интерес: 'Интересы',
  Экспертиза: 'Широкая экспертиза',
  Известное: 'Подтверждённые знания',
  Изучаю: 'Что сейчас изучаете',
  Предпочтения: 'Предпочтения по материалам',
};

export function profileText(
  source: string,
  params: Record<string, string | number> = {},
  language: UiLanguage = normalizeUiLanguage(document.documentElement.lang),
): string {
  const dayLabel = source.match(/^(\d+) дней$/u);
  if (dayLabel)
    return profileText('{count} дней', { count: dayLabel[1]! }, language);
  const importDays = source.match(
    /^Разрешить и обработать последние (\d+) дней$/u,
  );
  if (importDays)
    return profileText(
      'Разрешить и обработать последние {count} дней',
      { count: importDays[1]! },
      language,
    );
  if (source.startsWith('+ '))
    return `+ ${profileText(source.slice(2), params, language)}`;
  if (source === 'Открыть ChatGPT')
    return profileText('Открыть {provider}', { provider: 'ChatGPT' }, language);
  const providerLabel = source.match(
    /^Пусть (ChatGPT|Claude) представит меня$/u,
  );
  if (providerLabel)
    return profileText(
      'Пусть {provider} представит меня',
      { provider: providerLabel[1]! },
      language,
    );
  const pasteLabel = source.match(
    /^Вставьте запрос в (ChatGPT|Claude) и отправьте его\.$/u,
  );
  if (pasteLabel)
    return profileText(
      'Вставьте запрос в {provider} и отправьте его.',
      { provider: pasteLabel[1]! },
      language,
    );
  const key = aliases[source] ?? source;
  const text = PROFILE_TRANSLATIONS.get(key)?.[language] ?? source;
  return text.replace(/\{(\w+)\}/gu, (match, key: string) =>
    String(params[key] ?? match),
  );
}

interface StaticLabel {
  node: Text | HTMLElement;
  attribute?: string;
  source: string;
}

/** Capture only the original interface nodes, before any personal data is rendered. */
export function captureProfileLabels(root: HTMLElement): () => void {
  const labels: StaticLabel[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const source = node.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
    if (/[а-яё]/iu.test(source)) labels.push({ node: node as Text, source });
  }
  for (const element of root.querySelectorAll<HTMLElement>(
    '[placeholder], [aria-label]',
  )) {
    for (const attribute of ['placeholder', 'aria-label']) {
      const source = element.getAttribute(attribute);
      if (source) labels.push({ node: element, attribute, source });
    }
  }
  return () => {
    for (const label of labels) {
      if (label.attribute && label.node instanceof HTMLElement) {
        label.node.setAttribute(label.attribute, profileText(label.source));
      } else if (label.node.isConnected) {
        label.node.textContent = profileText(label.source);
      }
    }
  };
}
