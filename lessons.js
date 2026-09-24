// Lições de "O Homem Mais Rico da Babilônia" (George S. Clason), resumidas com nossas palavras.
// `app` diz onde o princípio aparece no aplicativo.

export const CURAS = [
  {
    n: 1,
    titulo: 'Comece a engordar sua bolsa',
    ideia: 'De cada dez moedas que entrarem, gaste no máximo nove. A primeira parte é sua: guarde-a antes de pagar qualquer outra coisa.',
    app: 'Ao lançar uma receita, o app sugere separar o seu percentual (10% por padrão) para uma caixinha.',
    view: 'patrimonio',
  },
  {
    n: 2,
    titulo: 'Controle seus gastos',
    ideia: 'Aquilo que chamamos de "despesas necessárias" cresce até engolir toda a renda, se não for vigiado. Separe necessidades de desejos e faça um orçamento.',
    app: 'Na aba Orçamento, cada categoria tem um limite e é marcada como necessidade ou desejo.',
    view: 'orcamento',
  },
  {
    n: 3,
    titulo: 'Faça seu ouro multiplicar',
    ideia: 'Dinheiro guardado deve trabalhar. Cada moeda aplicada gera outras, e essas também devem ser postas para trabalhar.',
    app: 'Em Patrimônio você registra onde cada caixinha está aplicada e acompanha o rendimento. O simulador mostra os juros compostos.',
    view: 'patrimonio',
  },
  {
    n: 4,
    titulo: 'Proteja seu tesouro de perdas',
    ideia: 'Antes de lucro, segurança. Desconfie de ganhos rápidos e ouça quem tem experiência no assunto antes de investir.',
    app: 'Cada caixinha tem um nível de risco. O app avisa quando muito do patrimônio está em risco alto.',
    view: 'patrimonio',
  },
  {
    n: 5,
    titulo: 'Faça de sua moradia um investimento',
    ideia: 'Ter a própria casa diminui custos, traz estabilidade e transforma o aluguel em patrimônio da família.',
    app: 'Crie uma caixinha com o objetivo "Casa própria" e acompanhe o progresso até a meta.',
    view: 'patrimonio',
  },
  {
    n: 6,
    titulo: 'Assegure uma renda futura',
    ideia: 'Prepare-se para a velhice e proteja a família contra imprevistos, enquanto ainda há força para trabalhar.',
    app: 'Use caixinhas de "Reserva de emergência" e "Renda futura / aposentadoria".',
    view: 'patrimonio',
  },
  {
    n: 7,
    titulo: 'Aumente sua capacidade de ganhar',
    ideia: 'Quanto mais sabedoria e habilidade, maior a renda. Estude, aperfeiçoe seu ofício e cumpra o que promete.',
    app: 'O painel compara a renda recente com a dos meses anteriores.',
    view: 'inicio',
  },
];

export const LEIS = [
  'O ouro chega, cada vez em maior quantidade, a quem guarda pelo menos um décimo do que ganha para o futuro da família.',
  'O ouro trabalha com dedicação para quem lhe dá uma ocupação lucrativa, multiplicando-se como os rebanhos no campo.',
  'O ouro permanece com quem o protege e investe seguindo o conselho de pessoas experientes.',
  'O ouro escapa de quem o aplica em negócios que não conhece ou que os experientes não aprovam.',
  'O ouro foge de quem busca ganhos impossíveis, segue conselhos de espertalhões ou confia na própria inexperiência.',
];

export const DABASIR = {
  titulo: 'O plano de Dabasir',
  ideia: 'Dabasir, o mercador de camelos, saiu das dívidas dividindo cada ganho em três partes: sete décimos para viver, dois décimos repartidos entre os credores na proporção do que devia a cada um, e um décimo guardado para si. Ele procurou cada credor, explicou o plano e o cumpriu até o fim.',
  passos: [
    'Liste todas as dívidas com o valor que falta pagar.',
    'A cada receita, reserve a parte dos credores (20% por padrão).',
    'Divida essa parte entre os credores na proporção do saldo de cada um. O app faz a conta.',
    'Mesmo com dívidas, continue guardando a sua parte (10%).',
    'Viva com o restante (70%). Se não couber, corte desejos antes de necessidades.',
  ],
};

// Dicas curtas usadas no painel conforme a situação do mês.
export const DICAS = {
  semRenda: {
    titulo: 'Tudo começa pela renda',
    texto: 'Lance as receitas do mês para o app calcular quanto guardar e quanto você pode gastar.',
  },
  guardarPouco: {
    titulo: 'Pague-se primeiro',
    texto: 'Neste mês você guardou menos que a sua meta. Separe a sua parte logo que o dinheiro entrar, e não com o que sobrar no fim do mês.',
    cura: 1,
  },
  gastoAlto: {
    titulo: 'As despesas crescem sozinhas',
    texto: 'Os gastos passaram do limite para viver. Veja no Orçamento quais categorias são desejos e podem esperar.',
    cura: 2,
  },
  dividas: {
    titulo: 'Onde há determinação, há caminho',
    texto: 'Com dívidas em aberto, o app segue o plano de Dabasir: 70% para viver, 20% para os credores e 10% para você.',
  },
  semReserva: {
    titulo: 'Construa as muralhas',
    texto: 'Assim como as muralhas protegiam a Babilônia, uma reserva de emergência protege a família. Uma meta comum é de 6 meses de gastos.',
    cura: 6,
  },
  multiplicar: {
    titulo: 'Coloque o ouro para trabalhar',
    texto: 'Você já guarda com constância. Garanta que cada caixinha esteja aplicada em algo seguro que renda, e não parada na conta.',
    cura: 3,
  },
  ok: {
    titulo: 'A bolsa está engordando',
    texto: 'Meta de guardar cumprida e gastos dentro do limite. Mantenha o hábito: é a constância que enriquece.',
  },
};
