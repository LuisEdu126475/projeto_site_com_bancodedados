/**
 * ============================================================================
 *  IDENTIDADE DA CAFETERIA  ·  arquivo white-label
 * ============================================================================
 *  Este arquivo concentra a identidade da cafeteria (nome, cores, contatos,
 *  canais, horários e textos). Ele é validado ao iniciar o servidor ou gerar
 *  o site estático (src/config/site.js): se algo estiver errado, o processo
 *  para e informa exatamente qual campo corrigir.
 *
 *  O cardápio fica em config/cardapio.config.js. No site com banco, depois
 *  do primeiro uso ele passa a ser editado pelo painel /admin.
 * ============================================================================
 */

export default {
  brand: {
    name: 'Croma',
    // Texto curto exibido ao lado do nome (logo tipográfico)
    descriptor: 'Specialty Coffee Roasters',
    // Razão social / CNPJ aparecem na Política de Privacidade e no rodapé
    legalName: 'Croma Cafés Especiais LTDA',
    cnpj: '00.000.000/0001-00',
    foundedYear: 2019,
  },

  /**
   * Tema visual. Presets disponíveis: 'noir' (escuro e dourado),
   * 'terra' (marrom quente e cobre) e 'creme' (claro e editorial).
   * As cores opcionais em `overrides` substituem as do preset.
   */
  theme: {
    preset: 'noir',
    overrides: {
      // accent: '#C9A26B',
    },
  },

  seo: {
    title: 'Croma | Specialty Coffee Roasters em Brasília',
    description:
      'Cafés especiais de microlotes 86+, torra artesanal semanal e experiências de degustação guiadas por baristas premiados. Reserve sua mesa em Brasília.',
    // Usado nas tags Open Graph e no link canônico (sobrescrito por PUBLIC_URL)
    url: 'http://localhost:3000',
    ogImage: '/images/hero.jpg',
    locale: 'pt_BR',
  },

  contact: {
    // Somente dígitos, com DDI: usado nos links do WhatsApp
    whatsapp: '5561900000000',
    phoneDisplay: '(61) 90000-0000',
    email: 'contato@croma.cafe',
    // Perfil do Instagram (link completo). Apague a linha se não tiver.
    instagram: 'https://instagram.com/croma.cafe',
    // Página da cafeteria no iFood (copie o link da barra de endereço do
    // navegador). Apague a linha se não estiver no iFood: os botões somem.
    ifood: 'https://www.ifood.com.br/',
    // Loja virtual de grãos, kits e presentes (opcional).
    // onlineStore: 'https://loja.croma.cafe',
    address: {
      street: 'SHCS CLS 405, Bloco C, Loja 38',
      district: 'Asa Sul',
      city: 'Brasília',
      state: 'DF',
      zip: '70239-030',
      country: 'BR',
    },
    mapsUrl: 'https://maps.google.com/?q=SHCS+CLS+405+Bloco+C+Brasilia',
  },

  /** Fuso horário da loja: todas as datas e horários de reserva usam ele. */
  timezone: 'America/Sao_Paulo',

  /**
   * Horário de funcionamento. `null` = fechado.
   * Cada dia aceita um ou mais intervalos: [['08:00', '12:00'], ['14:00', '19:00']]
   */
  hours: {
    mon: null,
    tue: [['08:00', '19:00']],
    wed: [['08:00', '19:00']],
    thu: [['08:00', '19:00']],
    fri: [['08:00', '21:00']],
    sat: [['09:00', '21:00']],
    sun: [['09:00', '18:00']],
  },

  reservations: {
    enabled: true,
    slotMinutes: 30, // intervalo entre horários oferecidos
    capacityPerSlot: 16, // nº máximo de pessoas por horário
    maxPartySize: 8, // maior grupo aceito online
    minLeadMinutes: 90, // antecedência mínima para reservar no mesmo dia
    maxAdvanceDays: 45, // até quantos dias à frente
    lastSeatingBeforeCloseMinutes: 60, // último horário antes do fechamento
    // Datas sem reservas (feriados, eventos fechados) no formato AAAA-MM-DD
    closedDates: ['2026-12-25', '2027-01-01'],
    experiences: [
      {
        id: 'degustacao',
        name: 'Degustação Guiada',
        description: 'Flight de três microlotes conduzido por um barista, 60 min.',
      },
      {
        id: 'brunch',
        name: 'Brunch de Assinatura',
        description: 'Menu sazonal da confeitaria harmonizado com filtrados.',
      },
      {
        id: 'espresso-bar',
        name: 'Espresso Bar',
        description: 'Lugares no balcão, de frente para a máquina e o barista.',
      },
      {
        id: 'mesa',
        name: 'Mesa no Salão',
        description: 'Uma mesa reservada para aproveitar no seu ritmo.',
      },
    ],
  },

  /** Textos das seções da página inicial. */
  content: {
    hero: {
      eyebrow: 'Cafés especiais em Brasília',
      titleLine1: 'O ritual do café,',
      titleLine2: 'elevado à arte.',
      lead: 'Microlotes de pontuação 86+ na escala SCA, torrados semanalmente em nossa casa e servidos por baristas premiados.',
    },
    marquee: [
      'Microlotes 86+ SCA',
      'Torra artesanal semanal',
      'Comércio direto com produtores',
      'Baristas certificados',
      'Confeitaria autoral',
    ],
    manifesto: {
      eyebrow: 'Manifesto',
      title: 'Da fazenda à sua xícara, sem atalhos.',
      paragraphs: [
        'A Croma nasceu da obsessão pela transparência. Conhecemos cada produtor pelo nome, visitamos suas fazendas e pagamos acima do preço justo para que a excelência seja sustentável.',
        'Torramos em pequenos lotes, toda semana, e servimos cada café no auge do seu frescor. Nada de café velho, nada de pressa.',
      ],
      stats: [
        { value: '88+', label: 'Pontuação média SCA' },
        { value: '12', label: 'Fazendas parceiras' },
        { value: '7 dias', label: 'Do torrador à xícara' },
      ],
    },
    // Seção dos canais (iFood, WhatsApp, loja e Instagram)
    channels: {
      title: 'Como você quer seu café hoje?',
    },
    ritual: {
      eyebrow: 'O processo',
      title: 'Três atos de um mesmo ritual.',
      steps: [
        {
          title: 'Origem',
          image: '/images/origem.jpg',
          text: 'Colheita seletiva, cereja por cereja, em fazendas da Mantiqueira, do Cerrado Mineiro e da Chapada Diamantina.',
        },
        {
          title: 'Torra',
          image: '/images/torra.jpg',
          text: 'Perfis de torra desenhados para cada lote, que revelam doçura, acidez e corpo na medida certa.',
        },
        {
          title: 'Xícara',
          image: '/images/ritual.jpg',
          text: 'Extração precisa, água filtrada por osmose e um barista dedicado a cada preparo.',
        },
      ],
    },
    gallery: [
      { src: '/images/galeria-interior.jpg', alt: 'Salão da cafeteria com mesas de mármore e poltronas de couro' },
      { src: '/images/galeria-espresso.jpg', alt: 'Espresso com crema sobre mármore escuro' },
      { src: '/images/galeria-confeitaria.jpg', alt: 'Croissant e bolo de chocolate artesanal ao lado de um cortado' },
      { src: '/images/galeria-graos.jpg', alt: 'Grãos de café especial sendo pesados em balança de precisão' },
    ],
    // ATENÇÃO: depoimentos de EXEMPLO. Troque por depoimentos reais (com
    // autorização de quem escreveu) antes de publicar, ou apague a lista
    // inteira (testimonials: []) para esconder a seção.
    testimonials: [
      {
        quote: 'O melhor V60 que já tomei no Brasil. A degustação guiada mudou minha forma de enxergar café.',
        author: 'Mariana A.',
        detail: 'Cliente desde 2021',
      },
      {
        quote: 'Ambiente impecável, atendimento atencioso e uma confeitaria à altura dos cafés.',
        author: 'Rafael M.',
        detail: 'Cliente da casa',
      },
      {
        quote: 'Viramos clientes da assinatura de grãos depois da primeira visita. Frescor absurdo.',
        author: 'Juliana e Pedro',
        detail: 'Assinantes',
      },
    ],
  },

  legal: {
    privacyPolicyVersion: '2026-10-01',
    dpoEmail: 'privacidade@croma.cafe',
    // Por quantos dias os dados pessoais de reservas passadas são mantidos
    // antes da anonimização (npm run lgpd:purge)
    retentionDays: 180,
  },
};

