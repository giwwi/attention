import type { UiLanguage } from './ui';

const en = {
  title: 'Let’s make this yours',
  compact:
    'Create your profile with ChatGPT or Claude to get reading recommendations.',
  intro:
    'To help you choose what to read, Attention needs to know your interests and what you already know.',
  providers:
    'Start with the ChatGPT or Claude you already use. You can add a profile from both.',
  create: 'Create my profile',
  opening: 'Opening…',
  failed: 'Couldn’t open setup. Try again.',
};
type Copy = Record<keyof typeof en, string>;
const copy: Record<UiLanguage, Copy> = {
  en,
  ru: {
    title: 'Давайте познакомимся',
    compact:
      'Создайте профиль с ChatGPT или Claude — и получайте советы, что читать.',
    intro:
      'Чтобы помочь выбрать, что читать, Attention нужно знать ваши интересы и то, в чём вы уже разбираетесь.',
    providers:
      'Начните с ChatGPT или Claude, с которым вы уже общались. Можно добавить профиль из обоих.',
    create: 'Создать мой профиль',
    opening: 'Открываем…',
    failed: 'Не удалось открыть настройку. Попробуйте ещё раз.',
  },
  de: {
    title: 'Lernen wir uns kennen',
    compact:
      'Erstelle dein Profil mit ChatGPT oder Claude für persönliche Lesetipps.',
    intro:
      'Damit Attention dir bei der Lesewahl helfen kann, braucht es deine Interessen und dein Vorwissen.',
    providers:
      'Starte mit dem ChatGPT oder Claude, das du schon nutzt. Du kannst Profile aus beiden ergänzen.',
    create: 'Mein Profil erstellen',
    opening: 'Wird geöffnet…',
    failed: 'Einrichtung konnte nicht geöffnet werden. Versuche es erneut.',
  },
  es: {
    title: 'Vamos a conocerte',
    compact:
      'Crea tu perfil con ChatGPT o Claude para recibir recomendaciones de lectura.',
    intro:
      'Para ayudarte a elegir qué leer, Attention necesita conocer tus intereses y lo que ya sabes.',
    providers:
      'Empieza con el ChatGPT o Claude que ya usas. Puedes añadir un perfil de ambos.',
    create: 'Crear mi perfil',
    opening: 'Abriendo…',
    failed: 'No se pudo abrir la configuración. Inténtalo de nuevo.',
  },
  fr: {
    title: 'Faisons connaissance',
    compact:
      'Créez votre profil avec ChatGPT ou Claude pour des conseils de lecture.',
    intro:
      'Pour vous aider à choisir quoi lire, Attention a besoin de connaître vos intérêts et vos connaissances.',
    providers:
      'Commencez avec le ChatGPT ou Claude que vous utilisez déjà. Vous pouvez ajouter un profil des deux.',
    create: 'Créer mon profil',
    opening: 'Ouverture…',
    failed: 'Impossible d’ouvrir la configuration. Réessayez.',
  },
  it: {
    title: 'Conosciamoci meglio',
    compact:
      'Crea il tuo profilo con ChatGPT o Claude per ricevere consigli di lettura.',
    intro:
      'Per aiutarti a scegliere cosa leggere, Attention deve conoscere i tuoi interessi e quello che sai già.',
    providers:
      'Inizia con il ChatGPT o Claude che usi già. Puoi aggiungere un profilo da entrambi.',
    create: 'Crea il mio profilo',
    opening: 'Apertura…',
    failed: 'Impossibile aprire la configurazione. Riprova.',
  },
  zh: {
    title: '先认识一下你',
    compact: '用 ChatGPT 或 Claude 创建个人资料，获取阅读建议。',
    intro: '要帮你选择读什么，Attention 需要了解你的兴趣和已有知识。',
    providers: '先用你平时聊天的 ChatGPT 或 Claude，也可以添加两者生成的资料。',
    create: '创建我的个人资料',
    opening: '正在打开…',
    failed: '无法打开设置，请重试。',
  },
  ar: {
    title: 'لنتعرّف عليك',
    compact: 'أنشئ ملفك مع ChatGPT أو Claude لتحصل على اقتراحات للقراءة.',
    intro:
      'ليساعدك Attention في اختيار ما تقرأه، يحتاج إلى معرفة اهتماماتك وما تعرفه بالفعل.',
    providers:
      'ابدأ مع ChatGPT أو Claude الذي تستخدمه عادةً. يمكنك إضافة ملف من كليهما.',
    create: 'إنشاء ملفي',
    opening: 'جارٍ الفتح…',
    failed: 'تعذر فتح الإعداد. حاول مجددًا.',
  },
  hi: {
    title: 'आइए आपको जानें',
    compact:
      'पढ़ने के सुझाव पाने के लिए ChatGPT या Claude से अपनी प्रोफ़ाइल बनाएँ।',
    intro:
      'क्या पढ़ना है यह चुनने में मदद के लिए Attention को आपकी रुचियाँ और मौजूदा ज्ञान जानना होगा।',
    providers:
      'जिस ChatGPT या Claude से आप पहले बात कर चुके हैं, उससे शुरू करें। आप दोनों की प्रोफ़ाइल जोड़ सकते हैं।',
    create: 'मेरी प्रोफ़ाइल बनाएँ',
    opening: 'खुल रहा है…',
    failed: 'सेटअप नहीं खुल सका। फिर कोशिश करें।',
  },
};
export function profileCardText(language: UiLanguage, key: keyof Copy): string {
  return copy[language][key];
}
