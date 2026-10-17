// =============================================================
// DRG-Rently — MEU SITE: modelo padrão de site de imobiliária
// =============================================================
// Todo cliente do Rently nasce com este site pronto (é o desenho do site da D.R. Global,
// que o dono aprovou), preenchido com os dados da própria imobiliária. Depois, o gestor
// (ou quem ele delegar) edita tudo em "🌐 Meu site". Usado pelo motor (site-engine.js)
// quando ainda não há site publicado, e pelo editor como primeiro rascunho.
//
// Formato da configuração (versão 1) — é o que fica em tenants/{t}/site/{rascunho|publicado}.config
//   identidade: { nome, complemento, seloTexto, seloImagem, logo, creci, corPrincipal, corDestaque, fonteTitulo, fonteTexto }
//   contato:    { whatsapp, email, endereco1, endereco2, cnpj, responsavel, creciResponsavel, botaoFlutuante }
//   menu:       { itens: [{ rotulo, destino }], botaoWhatsapp }
//   blocos:     [{ id, tipo, visivel, ...campos do tipo }]
//   rodape:     { texto, mostrarLegal }
//   seo:        { titulo, descricao, imagem }
// destino: 'inicio' | 'imoveis' | 'imoveis-locacao' | 'imoveis-venda' | 'corretor' | 'whatsapp'
//          | 'secao:<id do bloco>' | 'url:<endereço>'

(function () {
  const VERSAO = 1;
  const SUFIXOS = ['Negócios Imobiliários', 'Imobiliária', 'Imóveis'];

  // "D.R. Global Imóveis" → { nome: 'D.R. Global', complemento: 'Imóveis' }
  function dividirNome(nomeCompleto) {
    const n = String(nomeCompleto || 'Minha Imobiliária').trim();
    for (const s of SUFIXOS) {
      if (n.length > s.length && n.toLowerCase().endsWith(' ' + s.toLowerCase())) {
        return { nome: n.slice(0, -s.length - 1).trim(), complemento: n.slice(-s.length) };
      }
    }
    return { nome: n, complemento: '' };
  }
  const soDigitos = (v) => String(v || '').replace(/\D/g, '');

  function siteConfigPadrao(tenant = {}, extra = {}) {
    const { nome, complemento } = dividirNome(tenant.nome);
    const nomeCompleto = [nome, complemento].filter(Boolean).join(' ');
    const wa = soDigitos(extra.WHATSAPP || tenant.whatsapp || tenant.telefone);
    const creci = extra.CRECI_PJ || tenant.creci || '';
    const id = () => 'b' + Math.random().toString(36).slice(2, 8);
    return {
      versao: VERSAO,
      identidade: {
        nome, complemento,
        seloTexto: extra.SELO_TEXTO || '', seloImagem: '',
        logo: tenant.logoUrl || extra.LOGO || '',
        creci: extra.CRECI_PJ ? `CRECI/PJ ${extra.CRECI_PJ}` : (tenant.creci ? `CRECI ${String(tenant.creci).replace(/^CRECIs*/i, '')}` : ''),
        corPrincipal: '#232653', corDestaque: '#b29b52',
        fonteTitulo: 'Playfair Display', fonteTexto: 'Inter',
      },
      contato: {
        whatsapp: wa.length >= 10 && !wa.startsWith('55') ? '55' + wa : wa,
        email: extra.EMAIL || tenant.emailContato || '',
        endereco1: extra.ENDERECO_L1 || '',
        endereco2: extra.ENDERECO_L2 || '',
        cnpj: extra.CNPJ || tenant.cnpj || '',
        responsavel: extra.RESPONSAVEL || '',
        creciResponsavel: extra.CRECI_RESP || '',
        botaoFlutuante: true,
      },
      menu: {
        itens: [
          { rotulo: 'Início', destino: 'inicio' },
          { rotulo: 'Imóveis', destino: 'imoveis' },
          { rotulo: 'Serviços', destino: 'secao:servicos' },
          { rotulo: 'Anuncie', destino: 'secao:anuncie' },
          { rotulo: 'Corretor', destino: 'corretor' },
          { rotulo: 'Contato', destino: 'secao:contato' },
        ],
        botaoWhatsapp: true,
      },
      blocos: [
        { id: 'destaque', tipo: 'destaque', visivel: true, eyebrow: '',
          titulo: 'Seu imóvel em boas mãos, do anúncio à venda ou ao repasse do aluguel.',
          texto: extra.HERO_TEXTO || 'Locação, venda, administração de aluguéis e avaliação de imóveis, com atendimento próximo de você e transparência em cada fase da negociação.',
          imagem: 'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=1600&q=70',
          botao1: { rotulo: 'Ver imóveis disponíveis', destino: 'imoveis' },
          botao2: { rotulo: 'Anunciar meu imóvel', destino: 'secao:anuncie' } },
        { id: 'busca', tipo: 'busca', visivel: true },
        { id: 'imoveis', tipo: 'imoveis', visivel: true, eyebrow: 'Vitrine', titulo: 'Imóveis em destaque',
          texto: 'Atualizados diretamente do nosso sistema de gestão.', quantidade: 6, botao: 'Ver todos os imóveis' },
        { id: 'servicos', tipo: 'servicos', visivel: true, eyebrow: '', titulo: 'Serviços',
          texto: 'Soluções completas para proprietários, locatários e compradores.',
          itens: [
            { icone: '🏡', titulo: 'Compra e venda', texto: 'Intermediação na compra e venda de imóveis residenciais e comerciais, com apoio na documentação até a escritura.' },
            { icone: '🔑', titulo: 'Locação', texto: 'Divulgação do imóvel, visitas, análise cadastral do interessado e contrato com as garantias adequadas.' },
            { icone: '📊', titulo: 'Administração de aluguéis', texto: 'Cobrança mensal, repasse ao proprietário, prestação de contas e acompanhamento do contrato até a entrega das chaves.' },
            { icone: '📐', titulo: 'Avaliação de imóveis (PTAM)', texto: 'Parecer Técnico de Avaliação Mercadológica elaborado por corretor avaliador inscrito no CNAI.' },
          ] },
        { id: 'anuncie', tipo: 'anuncie', visivel: true, eyebrow: 'Proprietário', titulo: 'Anuncie seu imóvel conosco',
          texto: 'Envie os dados do seu imóvel e nossa equipe entra em contato para avaliar, fotografar e divulgar.',
          itens: ['Divulgação no site e nos principais portais imobiliários', 'Análise cadastral dos interessados', 'Contrato, vistoria e garantias', 'Repasse e prestação de contas mensais'],
          botao: 'Enviar', aviso: `Ao enviar, você autoriza o contato da ${nomeCompleto} sobre este anúncio.` },
        { id: 'corretores', tipo: 'corretor', visivel: true, eyebrow: 'Corretor de imóveis', titulo: `Venda com a ${nome}`,
          texto: 'Cadastre os seus imóveis na nossa rede, venda o acervo da imobiliária e receba a sua parte da comissão — tudo registrado no sistema.',
          botao: { rotulo: 'Área do corretor', destino: 'corretor' } },
        { id: 'contato', tipo: 'contato', visivel: true, eyebrow: 'Fale conosco', titulo: 'Contato',
          textoWhatsapp: 'Atendimento para locação, venda e administração.' },
      ],
      rodape: { texto: 'Locação, venda, administração e avaliação de imóveis.', mostrarLegal: true },
      seo: {
        titulo: extra.SEO_TITULO || `${nomeCompleto} – Locação, venda e administração de imóveis`,
        descricao: extra.SEO_DESCRICAO || `${nomeCompleto}: locação, venda, administração de aluguéis e avaliação de imóveis.${creci ? ' CRECI ' + creci + '.' : ''}`,
        imagem: tenant.logoUrl || '',
      },
      _novoBloco: id,   // (não é salvo — o editor usa para gerar ids)
    };
  }

  // Blocos que dá para acrescentar pelo editor
  const MODELOS_BLOCO = {
    texto: () => ({ tipo: 'texto', visivel: true, eyebrow: '', titulo: 'Novo bloco', texto: 'Escreva aqui.', imagem: '', ladoImagem: 'direita', fundo: 'claro', botao: { rotulo: '', destino: 'secao:contato' } }),
    servicos: () => ({ tipo: 'servicos', visivel: true, eyebrow: '', titulo: 'Novos serviços', texto: '', itens: [{ icone: '⭐', titulo: 'Item', texto: 'Descrição.' }] }),
    chamada: () => ({ tipo: 'chamada', visivel: true, titulo: 'Fale com a gente', texto: 'Tire suas dúvidas pelo WhatsApp.', botao: { rotulo: 'Conversar no WhatsApp', destino: 'whatsapp' } }),
    perguntas: () => ({ tipo: 'perguntas', visivel: true, eyebrow: 'Dúvidas', titulo: 'Perguntas frequentes', itens: [{ pergunta: 'Pergunta?', resposta: 'Resposta.' }] }),
  };

  // Normaliza uma configuração salva (campos que faltarem vêm do padrão) — versões futuras migram aqui
  function normalizarSiteConfig(cfg, tenant, extra) {
    const p = siteConfigPadrao(tenant, extra);
    delete p._novoBloco;
    if (!cfg || typeof cfg !== 'object') return p;
    return {
      versao: VERSAO,
      identidade: { ...p.identidade, ...(cfg.identidade || {}) },
      contato: { ...p.contato, ...(cfg.contato || {}) },
      menu: { ...p.menu, ...(cfg.menu || {}), itens: Array.isArray(cfg.menu?.itens) ? cfg.menu.itens : p.menu.itens },
      blocos: Array.isArray(cfg.blocos) ? cfg.blocos : p.blocos,
      rodape: { ...p.rodape, ...(cfg.rodape || {}) },
      seo: { ...p.seo, ...(cfg.seo || {}) },
    };
  }

  window.siteConfigPadrao = (t, e) => { const c = siteConfigPadrao(t, e); delete c._novoBloco; return c; };
  window.normalizarSiteConfig = normalizarSiteConfig;
  window.MODELOS_BLOCO_SITE = MODELOS_BLOCO;
  window.dividirNomeSite = dividirNome;
})();
