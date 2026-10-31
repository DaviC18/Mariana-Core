export interface CompanySettings {
	description: string;
	name: string;
	phone: string;
}

export interface ProductItem {
	desc: string;
	id: string;
	title: string;
}

export interface FaqItem {
	a: string;
	id: string;
	q: string;
}

export interface AgentSettings {
	instructions: string;
	maxWaitMinutes: number;
	tone: string;
}

export interface SystemSettingsPayload {
	agent: AgentSettings;
	company: CompanySettings;
	faq: FaqItem[];
	products: ProductItem[];
}

export const DEFAULT_SETTINGS: SystemSettingsPayload = {
	agent: {
		instructions:
			"Qualificar leads para consórcios imobiliários, automotivos e de frotas. Não fornecer parcelas ou taxas fictícias. Conduzir o cliente ao agendamento de reunião via Google Meet com os consultores.",
		maxWaitMinutes: 15,
		tone: "Profissional, consultiva e empática",
	},
	company: {
		description:
			"Especialistas em cartas de crédito para imóveis, veículos leves, frotas comerciais e planejamento financeiro com poder de compra à vista.",
		name: "Mariana Consórcios",
		phone: "Conforme número conectado à Z-API / WhatsApp Cloud API",
	},
	faq: [
		{
			a: "O sorteio ocorre mensalmente via Loteria Federal; o lance permite antecipar parcelas com recursos próprios ou FGTS para acelerar a contemplação.",
			id: "faq-1",
			q: "Qual a diferença entre sorteio e lance?",
		},
		{
			a: "É um encontro online de 30 minutos via Google Meet para simular parcelas, prazos e estratégias de lance personalizadas para o perfil do cliente.",
			id: "faq-2",
			q: "Como funciona a reunião com o consultor?",
		},
		{
			a: "O consórcio não cobra juros compensatórios, apenas a taxa de administração e fundo de reserva diluídos ao longo das parcelas.",
			id: "faq-3",
			q: "Quais são as taxas aplicadas?",
		},
	],
	products: [
		{
			desc: "Aquisição de imóveis residenciais, comerciais, reformas e construção com taxas administrativas reduzidas.",
			id: "prod-1",
			title: "Consórcio Imobiliário",
		},
		{
			desc: "Planos para compra de automóveis novos e seminovos sem cobrança de juros de financiamento.",
			id: "prod-2",
			title: "Consórcio de Veículos",
		},
		{
			desc: "Caminhões, implementos rodoviários e maquinário agrícola com foco em renovação de ativos.",
			id: "prod-3",
			title: "Frotas e Veículos Pesados",
		},
		{
			desc: "Alavancagem patrimonial e formação de carteira imobiliária por meio de lances programados.",
			id: "prod-4",
			title: "Planejamento e Disciplina",
		},
	],
};
