/**
 * Spanish story tables (tablas de la crónica): the same keys as story/tables-en.js, built the same way, in Spanish.
 *
 * Spanish needs to know whether a name is masculine or feminine to agree an adjective or a pronoun with it, and the
 * story can't know (a character, a creature, a weapon's name). So no entry agrees anything with {actor} or {target}:
 * no gendered adjectives or participles about them ("cae", not "caído"), no lo/la for them (their name again, or le),
 * and a weapon is "{su} {weapon}" (su or sus, by whether its name reads as plural: see possessive) or "con {weapon}".
 * A blow that misses or lands hard is told about the blow ("el golpe", "las llamas"), not the weapon, so nothing has to
 * agree with a weapon's name either.
 *
 * Placeholders: as the English, plus {su}.
 */
import { TIERS, DELIVERIES, DAMAGE_TYPES, TALK_KINDS, RELATIONSHIPS, MOVE_MODES, MOVE_SITUATIONS } from "./tables-en.js";

/** "su" or "sus" before a weapon's name: plural when its first word reads as plural ("Garras", "Dos espadas"). */
export function possessive(weapon) {
  const first = String(weapon ?? "").trim().split(/\s+/)[0] ?? "";
  return /[^s]s$/i.test(first) || /es$/i.test(first) ? "sus" : "su";
}

/**
 * Imagery for each damage type. hit and graze: what the attacker does to {target} ("golpea de lleno a"); wound: what
 * the hit does; miss and crit: what the blow does (a sentence of its own); botch: what the attacker does wrong.
 */
const TYPE = {
  bludgeoning: {
    hit: ["golpea de lleno a", "se estrella contra", "machaca a", "aporrea a", "sacude con fuerza a"],
    wound: ["algo cruje", "a {target} se le escapa el aire de golpe", "{target} se tambalea bajo el peso del golpe", "el impacto hace castañetear los dientes", "los huesos crujen con el impacto"],
    graze: ["roza a", "golpea de soslayo a", "da un toque a", "apenas alcanza a", "golpea de refilón a"],
    miss: ["el golpe se hunde en el suelo vacío", "el golpe pasa silbando", "el golpe solo atraviesa el aire", "el golpe da contra la piedra", "el golpe falla por un pelo"],
    crit: ["el golpe dobla a {target} por la mitad", "el golpe lanza a {target} como a un muñeco de trapo", "el impacto suena con un crujido espantoso", "el golpe hace retumbar a {target} como una campana", "el golpe arrolla la guardia de {target} y mucho más"],
    botch: ["pierde el equilibrio y casi cae", "siente el impacto hasta los hombros", "pierde el agarre un instante", "da media vuelta sin control", "se deja arrastrar por la inercia del golpe"]
  },
  piercing: {
    hit: ["perfora a", "hiere de punta a", "apuñala a", "ensarta a", "atraviesa a"],
    wound: ["la punta se hunde hondo", "la sangre brota alrededor de la herida", "{target} jadea por el pinchazo", "el arma se queda clavada un instante", "una mancha oscura se extiende"],
    graze: ["pincha a", "araña a", "hace un rasguño a", "alcanza de refilón a", "apenas encuentra a"],
    miss: ["la punta pasa de largo", "la punta resbala sobre la armadura", "la punta solo encuentra tela", "el ataque pasa silbando", "el ataque se clava sin daño muy cerca"],
    crit: ["la punta encuentra el hueco entre las placas", "el golpe clava a {target} como a un insecto en un alfiler", "el ataque atraviesa a {target} de lado a lado", "el ataque alcanza algo vital", "la punta llega hasta el hueso"],
    botch: ["engancha el arma y casi se le escapa de la mano", "lanza estocadas al vacío", "clava la punta en una grieta del suelo", "calcula fatal el ángulo", "se va de bruces tras la estocada"]
  },
  slashing: {
    hit: ["abre un tajo en", "corta de través a", "hiende a", "rasga a", "le abre una herida a"],
    wound: ["se abre una larga línea roja", "la tela y la piel se separan a la vez", "la sangre mana al instante", "{target} sisea cuando el filo muerde", "aparece un corte irregular"],
    graze: ["roza a", "traza una línea fina sobre", "pasa rozando a", "marca a", "acaricia apenas a"],
    miss: ["el filo silba en el aire vacío", "el filo solo muerde el aire", "el filo rebota en una guardia", "el tajo se queda corto", "el tajo traza un arco inútil en el vacío"],
    crit: ["el tajo casi parte en dos a {target}", "el tajo abre en canal a {target}", "el tajo dibuja un abanico de sangre", "el corte es tan hondo que dejará cicatriz de por vida", "el tajo atraviesa guardia y carne por igual"],
    botch: ["se pasa con el golpe y trastabilla", "entierra el filo en el suelo", "casi pierde el arma en pleno golpe", "gira a medias sobre los talones", "traza un arco torpe que deja una abertura"]
  },
  fire: {
    hit: ["envuelve en llamas a", "chamusca a", "abrasa a", "prende fuego a", "baña en fuego a"],
    wound: ["huele a pelo chamuscado", "la piel se ampolla y ennegrece", "{target} se da manotazos contra las llamas", "el humo sale de la ropa quemada", "las brasas saltan alrededor de {target}"],
    graze: ["chamusca apenas a", "lame con sus llamas a", "calienta a", "pasa parpadeando sobre", "roza con el fuego a"],
    miss: ["el fuego pasa rugiendo en una ola de calor", "las llamas salpican el suelo sin daño", "el fuego se apaga antes de llegar", "la llamarada se desvía", "el fuego deja una marca negra junto a {target}"],
    crit: ["las llamas convierten a {target} en una antorcha viviente", "el fuego estalla contra {target} en una bola de llamas", "el fuego abrasa a {target} hasta la médula", "las llamas envuelven por completo a {target}", "el fuego arde con tanta fuerza que todos apartan la mirada"],
    botch: ["solo consigue que el fuego chisporrotee y se apague", "ve cómo la llamarada se vuelve en su contra", "no saca más que unas chispas inofensivas", "se chamusca la propia manga", "ve cómo el fuego se pierde en el cielo"]
  },
  cold: {
    hit: ["cubre de escarcha a", "muerde con el frío a", "congela a", "escarcha a", "hiela a"],
    wound: ["el hielo cruje sobre la piel de {target}", "el aliento se vuelve vaho de repente", "las extremidades de {target} se entumecen", "la escarcha florece sobre la armadura", "los dedos se quedan blancos y sin tacto"],
    graze: ["pellizca con el frío a", "escarcha el borde de", "pasa helando junto a", "echa un soplo gélido sobre", "toca con el frío a"],
    miss: ["la helada deja una capa de escarcha en el suelo", "la helada pasa silbando en una nube de cristales", "el hielo estalla en aguanieve inofensiva", "el frío solo enfría el aire", "la helada escarcha la pared más cercana"],
    crit: ["el hielo encierra a {target}", "el frío congela a {target} por completo un instante", "el hielo cruje como un glaciar contra {target}", "la escarcha deja a {target} temblando", "el frío roba a {target} hasta la última pizca de calor"],
    botch: ["no consigue más que una ligera nevada", "se escarcha sus propios dedos", "ve cómo el hielo se rompe en el aire", "ve cómo el hielo se derrite antes de llegar", "solo levanta una neblina inofensiva"]
  },
  electricity: {
    hit: ["sacude con una descarga a", "lanza un arco eléctrico contra", "electrocuta a", "da una descarga a", "fulmina a"],
    wound: ["los músculos de {target} se agarrotan", "el pelo se eriza", "el olor a ozono lo llena todo", "{target} se sacude como una marioneta", "las chispas bailan sobre el metal"],
    graze: ["cosquillea a", "chisporrotea contra", "da un chasquido a", "crepita cerca de", "zumba sobre"],
    miss: ["el rayo se bifurca hacia el suelo", "la descarga se pierde en la tierra", "el rayo pasa con un trueno seco", "la descarga baila por una pared", "el rayo se deshace en una lluvia de chispas"],
    crit: ["la descarga ilumina a {target} desde dentro", "el rayo golpea a {target} con un trueno", "la descarga deja a {target} humeando y temblando", "el arco recorre cada hebilla y cada clavo", "el rayo levanta a {target} del suelo"],
    botch: ["suelta chispas en todas direcciones sin ningún efecto", "se da la descarga en su propio brazo", "solo produce un resplandor inofensivo", "descarga el rayo a sus propios pies", "ve cómo la descarga estalla como una pompa de jabón"]
  },
  acid: {
    hit: ["salpica de ácido a", "corroe a", "rocía a", "empapa de ácido a", "quema con ácido a"],
    wound: ["la armadura sisea y se llena de picaduras", "{target} grita cuando el ácido muerde", "sale humo de la herida", "el hedor hace llorar los ojos", "la piel burbujea y se desprende"],
    graze: ["salpica apenas a", "escupe ácido sobre", "salpica de gotas a", "gotea sobre", "roza con el ácido a"],
    miss: ["el ácido chisporrotea en la tierra", "el ácido abre un agujero en el suelo", "el ácido salpica lejos", "el ácido sisea sin daño", "el ácido corroe una piedra cercana"],
    crit: ["el ácido cubre por completo a {target}", "el ácido atraviesa las defensas de {target}", "el ácido muerde hondo con un siseo horrible", "el ácido empapa a {target} en una ruina cáustica", "el ácido deja a {target} con cicatrices humeantes"],
    botch: ["lo salpica todo menos a su objetivo", "ve cómo el ácido le salpica de vuelta", "solo consigue un goteo débil", "ve cómo el ácido burbujea y se pierde", "se quema un agujero en la propia mochila"]
  },
  sonic: {
    hit: ["retumba contra", "chilla dentro de los oídos de", "estremece a", "hace temblar a", "truena contra"],
    wound: ["a {target} le zumban los oídos", "los dientes vibran en el cráneo de {target}", "{target} se tambalea, sin saber dónde está", "el polvo cae por todas partes", "el propio aire se estremece"],
    graze: ["zumba contra", "pasa zumbando junto a", "resuena sobre", "vibra cerca de", "gime sobre"],
    miss: ["el estruendo rebota en las paredes", "el estruendo se aleja como un trueno lejano", "el sonido hace añicos un guijarro", "el estruendo retumba en el aire vacío", "el sonido se pierde en un zumbido sordo"],
    crit: ["el estruendo estalla contra {target} como un trueno", "el sonido sacude a {target} hasta los huesos", "el estruendo hace sangrar los oídos de {target}", "el sonido es tan fuerte que todos se encogen", "el estruendo destroza por completo el equilibrio de {target}"],
    botch: ["solo suelta un chillido débil", "recibe el eco de su propio estruendo", "desafina por completo", "ve cómo el sonido se apaga en silencio", "siente vibrar sus propios dientes"]
  },
  force: {
    hit: ["golpea con fuerza invisible a", "aporrea a", "alcanza a", "se estrella contra", "empuja con violencia a"],
    wound: ["{target} se tambalea por el golpe invisible", "el aire ondula con el impacto", "el golpe hace retroceder un paso a {target}", "suena como un tambor golpeado", "{target} gruñe bajo la presión"],
    graze: ["empuja a", "zarandea a", "presiona a", "da un empujón a", "sacude a"],
    miss: ["la fuerza pasa ondulando sin daño", "la fuerza se disipa en un destello", "la fuerza golpea el suelo con un ruido sordo", "la fuerza se curva y se pierde", "la fuerza parpadea y se apaga"],
    crit: ["la fuerza lanza a {target} hacia atrás", "la fuerza martillea a {target} con puños invisibles", "la fuerza aplasta la guardia de {target}", "la fuerza estampa a {target} contra el suelo", "la fuerza atraviesa de un golpe las defensas de {target}"],
    botch: ["ve cómo la magia se deshace en motas de luz", "recibe el rebote de su propia fuerza", "solo consigue un leve destello", "ve cómo la fuerza se tuerce y se pierde", "ve cómo la fuerza estalla sin daño"]
  },
  vitality: {
    hit: ["abrasa con luz a", "arde dentro de", "quema a", "inunda de luz a", "purifica a"],
    wound: ["{target} retrocede ante la luz viva", "la carne antinatural de {target} humea", "un brillo radiante se aferra a {target}", "{target} chilla bajo la luz abrasadora", "la luz quema las sombras"],
    graze: ["brilla contra", "roza a", "calienta a", "parpadea sobre", "cosquillea a"],
    miss: ["la luz florece sin daño en el aire", "la luz se desvanece como la bruma del alba", "la luz pasa de largo", "la luz centellea y se aleja", "la luz ilumina el suelo"],
    crit: ["la luz baña a {target} en un resplandor abrasador", "la luz quema a {target} como el sol de mediodía", "la luz arde a través de {target}", "la luz deja a {target} humeando y aullando", "la luz pura purifica a {target}"],
    botch: ["solo consigue un brillo débil", "se ilumina a sí como un farol", "ve cómo la luz se apaga antes de llegar", "ve cómo la luz se dispersa en destellos", "ve cómo la luz se atenúa hasta desaparecer"]
  },
  void: {
    hit: ["marchita a", "drena a", "arranca la vida a", "pudre a", "consume a"],
    wound: ["la piel de {target} se vuelve gris y se agrieta", "el calor abandona el rostro de {target}", "{target} se estremece cuando algo vital se le escapa", "las venas se oscurecen bajo la piel de {target}", "{target} envejece un año en un instante"],
    graze: ["roza la vida de", "apaga un poco a", "toca a", "enfría a", "agrisa el borde de"],
    miss: ["la sombra marchita la hierba", "la sombra se funde con la oscuridad", "la sombra se filtra en la tierra", "la sombra se aleja como humo", "la sombra pudre una viga cercana"],
    crit: ["la sombra deja a {target} demacrado de ojos hundidos", "la sombra bebe a fondo de la vida de {target}", "la sombra marchita a {target} casi hasta el hueso", "la sombra envuelve a {target} en un sudario de podredumbre", "la sombra le roba todo el color a {target}"],
    botch: ["solo consigue una sombra inofensiva", "se hiela su propia mano", "ve cómo la sombra se disuelve en penumbra", "ve cómo la sombra se hunde en el suelo", "ve cómo la sombra parpadea y se apaga"]
  },
  poison: {
    hit: ["envenena a", "inyecta veneno a", "enferma a", "contamina a", "emponzoña a"],
    wound: ["{target} tiene arcadas", "los labios de {target} se amoratan", "un rubor febril sube por el cuello de {target}", "{target} se tambalea, con náuseas", "las venas se oscurecen alrededor de la herida"],
    graze: ["pica a", "mancha a", "roza a", "apenas toca a", "salpica a"],
    miss: ["el veneno gotea sin daño", "el veneno falla por un pelo", "el veneno perla sobre la armadura", "el veneno salpica lejos", "el veneno nunca encuentra piel"],
    crit: ["el veneno inunda a {target}", "el veneno deja a {target} entre convulsiones", "el veneno hace tambalearse a {target} entre arcadas", "el veneno llega al centro mismo de {target}", "el veneno vuelve verdosa la piel de {target}"],
    botch: ["deja caer el veneno sin efecto", "casi se envenena con su propia arma", "descubre que el veneno ya no sirve", "lo derrama todo", "ve cómo el veneno se reseca y se descascara"]
  },
  bleed: {
    hit: ["abre una herida a", "desgarra a", "rasga la carne de", "lacera a", "corta a"],
    wound: ["la sangre corre libre", "la herida no se cierra", "el rojo gotea sin parar", "{target} se aprieta la herida con la mano", "{target} deja un rastro de sangre"],
    graze: ["araña a", "hace un corte a", "raspa a", "roza a", "marca a"],
    miss: ["el ataque no encuentra dónde morder", "el ataque resbala", "el ataque no saca sangre", "el ataque falla el blanco", "el ataque solo rasga tela"],
    crit: ["el ataque abre una herida que mana a chorros", "el ataque deja a {target} empapado de rojo", "el ataque desgarra algo que no deja de sangrar", "el ataque arranca un surtidor de sangre", "el ataque abre en canal a {target}"],
    botch: ["no engancha nada", "falla sin control", "se le traba el arma", "resbala", "se desgarra la propia manga"]
  },
  mental: {
    hit: ["asalta la mente de", "desgarra los pensamientos de", "abruma a", "retuerce la mente de", "apuñala los pensamientos de"],
    wound: ["{target} se agarra la cabeza", "la mirada de {target} se pierde", "{target} grita ante visiones que nadie más ve", "los pensamientos de {target} se dispersan", "a {target} le gotea sangre de la nariz"],
    graze: ["inquieta a", "susurra a", "roza la mente de", "incordia a", "parpadea en los pensamientos de"],
    miss: ["el ataque resbala sobre una voluntad de hierro", "el ataque solo encuentra una mente cerrada", "el ataque resuena en una cabeza vacía", "el ataque se deshace en ruido", "el ataque se rompe contra la concentración de {target}"],
    crit: ["el ataque hace añicos la concentración de {target}", "el ataque hunde a {target} en una pesadilla en vela", "el ataque vuelve los pensamientos de {target} en su contra", "el ataque deja a {target} balbuceando", "el ataque parte la mente de {target} como un huevo"],
    botch: ["recibe el golpe en su propia cabeza", "se pierde en la confusión", "no consigue más que un revoltijo", "acaba con un dolor de cabeza", "se queda con la cabeza dando vueltas"]
  },
  spirit: {
    hit: ["golpea el alma de", "desgarra a", "azota el espíritu de", "purga a", "quema la esencia de"],
    wound: ["el espíritu de {target} se estremece", "una luz fantasmal destella alrededor de {target}", "{target} siente que algo se le desprende", "{target} jadea cuando le tocan el alma", "las sombras huyen de {target}"],
    graze: ["roza el espíritu de", "toca a", "parpadea sobre", "enfría a", "remueve a"],
    miss: ["el ataque atraviesa como un fantasma", "el ataque se desvanece con un suspiro", "el ataque se aleja flotando", "el ataque no encuentra alma que golpear", "el ataque se disipa como el vaho en un cristal"],
    crit: ["el ataque desgarra el alma misma de {target}", "el ataque deja a {target} con el alma vacía y temblando", "el ataque arranca medio espíritu de {target}", "el ataque arde a través de la esencia de {target}", "el ataque acalla algo muy hondo en {target}"],
    botch: ["ve cómo el poder se aleja como humo", "termina con su propio ánimo revuelto", "ve cómo el poder se pierde sin que nadie lo note", "deja que el poder se le escape", "ve cómo el poder se atenúa hasta desaparecer"]
  },
  untyped: {
    hit: ["golpea a", "alcanza a", "acierta a", "da de lleno a", "conecta con"],
    wound: ["{target} hace una mueca", "{target} gruñe de dolor", "{target} cede terreno", "{target} se tambalea", "{target} maldice"],
    graze: ["roza a", "toca apenas a", "casi no alcanza a", "golpea de refilón a", "araña a"],
    miss: ["el ataque falla", "el ataque se va lejos", "el ataque se queda corto", "el ataque es desviado", "el ataque no encuentra nada"],
    crit: ["el ataque llega perfecto", "el ataque golpea certero y fuerte", "el ataque deja a {target} por los suelos", "el ataque da justo donde duele", "el ataque conecta con una fuerza devastadora"],
    botch: ["lo hace todo mal", "deja una abertura", "pierde el control del ataque", "falla de mala manera", "se le desmorona el ataque"]
  }
};

/** How each delivery is described: aim, what the attacker does as it attacks. */
const DELIVERY = {
  melee: { aim: ["acorta distancias", "presiona el ataque", "se cuela en la guardia de {target}", "finta y golpea", "se lanza a fondo"] },
  ranged: { aim: ["apunta", "afina la puntería", "respira hondo y dispara", "dispara desde su posición", "suelta un disparo rápido"] },
  spell: { aim: ["teje el conjuro", "pronuncia las palabras", "traza el sigilo", "reúne el poder", "libera la magia"] }
};

/** Five sentence shapes per delivery and tier. */
const SHAPES = {
  melee: {
    criticalSuccess: ["{actor} {aim} y descarga {su} {weapon}: ¡{crit}!", "Una apertura perfecta para {actor}: {crit}.", "{actor} ruge y ataca con {su} {weapon}; {crit}, y {wound}.", "{actor} se mueve como una tormenta con {su} {weapon}: {crit}.", "Nada podía detenerlo: {actor} ataca con {su} {weapon} y {crit}."],
    majorSuccess: ["{actor} {hit} {target} con {su} {weapon} con margen de sobra; {wound}.", "{actor} {aim} y {hit} {target} con {su} {weapon}; {wound}.", "{target} no lo ve venir: {actor} {hit} {target} con {su} {weapon}; {wound}.", "{actor} rompe la guardia de {target} y {hit} {target} con {su} {weapon}; {wound}.", "Con brutal facilidad, {actor} {hit} {target} con {su} {weapon}; {wound}."],
    success: ["{actor} {hit} {target} con {su} {weapon}; {wound}.", "{actor} {aim} y {hit} {target} con {su} {weapon}.", "En un torbellino de golpes, {actor} {hit} {target} con {su} {weapon}; {wound}.", "{actor} encuentra un hueco y {hit} {target} con {su} {weapon}.", "{actor} intercambia golpes con {target} y {hit} {target} con {su} {weapon}."],
    minorSuccess: ["{actor} {graze} {target} con {su} {weapon}, lo justo para hacer daño.", "{target} se aparta, pero {actor} aún {graze} {target} con {su} {weapon}.", "Por muy poco: {actor} {graze} {target} con {su} {weapon}.", "{actor} se estira de más, pero aún {graze} {target} con {su} {weapon}.", "Por un dedo de distancia, {actor} {graze} {target} con {su} {weapon}."],
    minorFailure: ["{actor} ataca con {su} {weapon}, pero {miss}; tan cerca que {target} nota el aire.", "{target} se echa atrás de un tirón: {miss}.", "¡Casi! {actor} ataca con {su} {weapon}, pero {miss}.", "{actor} se lanza con {su} {weapon}, y {miss} por centímetros.", "{target} para en el último instante; {miss}."],
    failure: ["{actor} ataca con {su} {weapon}, pero {miss}.", "{target} se hace a un lado, y {miss}.", "{actor} lanza un golpe con {su} {weapon}, pero {miss}.", "{target} desvía el golpe de {actor}; {miss}.", "{actor} presiona con {su} {weapon}, pero {miss}."],
    majorFailure: ["{actor} anuncia el golpe a la legua, y {miss}.", "{target} lee a {actor} con facilidad; {miss}.", "{actor} agita {su} {weapon} sin control, y {miss}, ni de lejos.", "A {target} casi se le escapa la risa: {miss}.", "Muy lejos: {actor} ataca con {su} {weapon} y {miss}."],
    criticalFailure: ["{actor} {botch}.", "Desastre: {actor} {botch}.", "El ataque de {actor} sale mal: {actor} {botch}.", "{target} se aparta y {actor} {botch}.", "{actor} {botch}, sin ninguna defensa."]
  },
  ranged: {
    criticalSuccess: ["{actor} {aim} con {su} {weapon}: ¡{crit}!", "Un disparo perfecto de {actor}: {crit}.", "Desde el otro lado del campo, {actor} dispara {su} {weapon}; {crit}, y {wound}.", "{actor} ni parece apuntar con {su} {weapon}: {crit}.", "El disparo de su vida: {actor} dispara {su} {weapon} y {crit}."],
    majorSuccess: ["{actor} {hit} {target} justo en el centro con {su} {weapon}; {wound}.", "{actor} {aim} y {hit} {target} con {su} {weapon}; {wound}.", "{actor} {hit} {target} con {su} {weapon} antes de que pueda reaccionar; {wound}.", "Limpio y certero, {actor} {hit} {target} con {su} {weapon}; {wound}.", "{actor} {hit} {target} de lleno con {su} {weapon}; {wound}."],
    success: ["{actor} {aim} y {hit} {target} con {su} {weapon}.", "{actor} {hit} {target} con {su} {weapon}; {wound}.", "{actor} dispara y {hit} {target} con {su} {weapon}.", "Sin aviso, {actor} {hit} {target} con {su} {weapon}.", "{actor} {aim}, y {su} {weapon} encuentra a {target}."],
    minorSuccess: ["{actor} {graze} {target} con {su} {weapon}.", "{target} da un quiebro, pero {actor} aún {graze} {target} con {su} {weapon}.", "Por muy poco, {actor} {graze} {target} con {su} {weapon}.", "Con un disparo apresurado, {actor} {graze} {target}.", "{actor} {graze} {target} con {su} {weapon}, más por suerte que por habilidad."],
    minorFailure: ["{actor} dispara {su} {weapon}, pero {miss}, a un palmo de {target}.", "{target} oye pasar el disparo de {actor}: {miss}.", "Tan cerca: {actor} dispara, pero {miss}.", "{target} se encoge cuando {miss}.", "{actor} maldice: {miss} por un suspiro."],
    failure: ["{actor} dispara {su} {weapon}, pero {miss}.", "{actor} suelta el disparo, pero {miss}.", "{target} se mueve en el último momento, y {miss}.", "{actor} dispara; {miss}, y {target} sigue avanzando.", "{actor} vuelve a disparar; {miss}."],
    majorFailure: ["{actor} dispara {su} {weapon}, pero {miss}, ni cerca de {target}.", "Un disparo a lo loco: {miss}.", "{actor} se precipita con el disparo, y {miss}.", "{actor} dispara, y {miss} por un kilómetro.", "{target} ni se inmuta: {miss}."],
    criticalFailure: ["{actor} {botch}.", "{actor} estropea el disparo y {botch}.", "Desastre para {actor}, que {botch}.", "La puntería de {actor} falla del todo: {actor} {botch}.", "{actor} {botch}, para regocijo de {target}."]
  },
  spell: {
    criticalSuccess: ["{actor} {aim}: ¡{su} {weapon} estalla y {crit}!", "El poder brota de {su} {weapon}: {crit}.", "{actor} lanza {su} {weapon}; {crit}, y {wound}.", "El propio aire retrocede ante {su} {weapon}: {crit}.", "{actor} lo da todo con {su} {weapon}: {crit}."],
    majorSuccess: ["{actor} {hit} {target} con toda la fuerza de {su} {weapon}; {wound}.", "{actor} {aim} y {hit} {target} con {su} {weapon}; {wound}.", "{target} no puede escapar: {actor} {hit} {target} con {su} {weapon}; {wound}.", "{actor} {hit} {target} con {su} {weapon}, que recibe todo el impacto; {wound}.", "{actor} {hit} {target} de lleno con {su} {weapon}; {wound}."],
    success: ["{actor} {hit} {target} con {su} {weapon}.", "{actor} {aim}; con {su} {weapon} {hit} {target}; {wound}.", "{actor} lanza {su} {weapon} y {hit} {target}.", "{actor} termina el conjuro y {hit} {target} con {su} {weapon}.", "{actor} {hit} {target} con {su} {weapon}; {wound}."],
    minorSuccess: ["{target} se retuerce, pero {actor} aún {graze} {target} con {su} {weapon}.", "{actor} {graze} {target} con {su} {weapon}, con la mitad de su fuerza.", "{target} aguanta, y {actor} solo {graze} {target} con {su} {weapon}.", "{actor} {graze} {target} con {su} {weapon} mientras {target} se pone a cubierto.", "Solo en parte: {actor} {graze} {target} con {su} {weapon}."],
    minorFailure: ["{target} se libra del conjuro de {actor} en el último instante: {miss}.", "{actor} lanza {su} {weapon}, pero {miss}, por muy poco.", "{target} se zafa: {miss}.", "{actor} lanza {su} {weapon}; {miss}, por los pelos.", "Tan cerca, pero {miss}."],
    failure: ["{target} resiste; {miss}.", "{actor} lanza {su} {weapon}, pero {miss}.", "{target} se mantiene firme: {miss}.", "{actor} lanza {su} {weapon}, pero {miss}.", "{actor} lanza {su} {weapon}; {miss}, y {target} sale sin daño."],
    majorFailure: ["{target} se sacude el conjuro de {actor} por completo: {miss}.", "{actor} lanza {su} {weapon}, pero {miss}, resistido sin esfuerzo.", "{target} apenas lo nota: {miss}.", "{actor} lanza {su} {weapon}; {miss}, y a {target} no le impresiona.", "La magia de {actor} vacila: {miss}."],
    criticalFailure: ["{target} se sacude el conjuro de {actor} como una brisa, y {actor} {botch}.", "Con {su} {weapon}, {actor} {botch}.", "{actor} pierde el hilo del conjuro y {botch}.", "{target} se ríe mientras {actor} {botch}.", "{actor} {botch}; {target} sale intacto de ello."]
  }
};

const TALK = {
  persuade: {
    verb: ["razona con", "apela a", "suplica a", "ofrece un trato a", "habla con franqueza a"],
    good: ["{target} baja un poco el arma", "{target} duda y escucha", "algo se ablanda en la postura de {target}", "{target} mira a sus aliados, sin saber qué hacer", "{target} parece sopesar la oferta"],
    bad: ["{target} no escucha", "{target} niega con la cabeza", "las palabras caen en saco roto", "{target} solo aprieta más el arma", "{target} escupe ante la propuesta"]
  },
  intimidate: {
    verb: ["amenaza a", "ruge a", "sostiene la mirada de", "promete la ruina a", "brama a"],
    good: ["{target} da un paso atrás sin querer", "{target} palidece", "a {target} le tiemblan las manos", "{target} busca una salida", "{target} traga saliva"],
    bad: ["{target} se ríe", "{target} no cede terreno", "{target} responde con desprecio", "a {target} no le impresiona", "{target} contesta con un gruñido"]
  },
  deceive: {
    verb: ["engaña a", "miente con soltura a", "le cuenta un cuento a", "embauca a", "teje una historia para"],
    good: ["{target} se cree cada palabra", "la duda asoma en los ojos de {target}", "{target} mira alrededor con nervios", "{target} se lo cree, por ahora", "{target} empieza a dudar de todo"],
    bad: ["{target} lo ve venir", "{target} entrecierra los ojos", "la mentira es demasiado fina", "a {target} no se le engaña", "{target} descubre el farol"]
  }
};

const TALK_SHAPES = {
  criticalSuccess: ["{actor} {verb} {target}, y cada palabra da en el blanco; {good}.", "{actor} {verb} {target} a la perfección; {good}.", "Las palabras de {actor} golpean como un martillo; {good}.", "{actor} {verb} {target} con total convicción; {good}.", "Es magistral: {actor} {verb} {target}, y {good}."],
  majorSuccess: ["{actor} {verb} {target}; {good}.", "{actor} {verb} {target} con soltura; {good}.", "{actor} {verb} {target} con aplomo; {good}.", "{target} no puede rebatir a {actor}; {good}.", "{actor} {verb} {target}, y {good}."],
  success: ["{actor} {verb} {target}; {good}.", "{actor} {verb} {target}, y algo funciona; {good}.", "{actor} {verb} {target} entre golpe y golpe; {good}.", "{actor} {verb} {target}; poco a poco, {good}.", "{actor} {verb} {target}; {good}."],
  minorSuccess: ["{actor} {verb} {target}, lo justo para convencer; {good}.", "{actor} se enreda con las palabras, pero aun así {verb} {target}; {good}.", "{actor} {verb} {target}; por poco, {good}.", "Es poco firme, pero {actor} {verb} {target}; {good}.", "{actor} {verb} {target}, y {good}, aunque por muy poco."],
  minorFailure: ["{actor} {verb} {target}, y casi lo consigue; {bad}.", "{actor} {verb} {target}, pero {bad}, aunque por muy poco.", "{actor} {verb} {target}; por un momento parece funcionar, pero {bad}.", "{actor} {verb} {target}; {bad}, aunque {target} duda.", "{actor} {verb} {target}; casi, pero {bad}."],
  failure: ["{actor} {verb} {target}; {bad}.", "{actor} {verb} {target}, pero {bad}.", "{actor} {verb} {target} sin efecto; {bad}.", "{actor} {verb} {target}; {bad}.", "{actor} {verb} {target} en vano; {bad}."],
  majorFailure: ["{actor} {verb} {target} con torpeza; {bad}.", "{actor} {verb} {target}, y le sale el tiro por la culata; {bad}.", "El intento de {actor} se viene abajo; {bad}.", "{actor} {verb} {target} fatal; {bad}.", "{actor} {verb} {target}; {bad}, y {target} se enfada todavía más."],
  criticalFailure: ["{actor} {verb} {target} y lo empeora todo; {target} no volverá a escuchar a {actor}.", "Las palabras de {actor} son un insulto; {target} no quiere oír ni una más.", "{actor} {verb} {target}, y la conversación se acaba para siempre.", "Las palabras de {actor} enfurecen a {target}; ya no hay nada que hablar.", "{actor} {verb} {target}; {bad}, y {target} jura no volver a escuchar."]
};

/** Relationship clauses, appended to attack or talk sentences. "none" is usually silent. */
const RELATIONSHIP = {
  none: { success: ["", "", "", "", ""], failure: ["", "", "", "", ""] },
  enemyLeader: {
    success: [" El líder enemigo se estremece.", " Su comandante flaquea, y toda la línea lo nota.", " Un golpe al corazón del enemigo.", " El líder del enemigo sangra a la vista de todos.", " Su campeón no es invencible, después de todo."],
    failure: [" El líder enemigo se lo sacude con desprecio.", " Su comandante apenas lo nota.", " Los seguidores del líder enemigo lo vitorean.", " Su campeón sigue en pie, firme.", " El líder sale intacto, y todos lo ven."]
  },
  talkingNemesis: {
    success: [" Después de tanta discusión, esta es la respuesta.", " Las palabras fallaron; esto no.", " Ahora {target} ya no ignorará a {actor}.", " Se acabó no escuchar.", " Esta vez {target} oye a {actor} alto y claro."],
    failure: [" {target} sonríe con desdén, como antes.", " Una vez más {target} rechaza a {actor}.", " {target} sigue tan inamovible como siempre.", " Nada de lo que hace {actor} llega a {target}.", " {target} ha dejado de tomarse en serio a {actor}."]
  },
  grudge: {
    success: [" Por fin, la revancha.", " {actor} no ha olvidado la herida de antes.", " Ese era personal.", " {actor} devuelve el favor con intereses.", " La deuda se paga en la misma moneda."],
    failure: [" La rabia le estropea el momento a {actor}.", " La ira vuelve torpe a {actor}.", " El rencor nubla la puntería de {actor}.", " {actor} lo desea demasiado.", " La furia no sustituye a la destreza."]
  },
  avenger: {
    success: [" Eso fue por los caídos.", " {actor} golpea en nombre de su amigo.", " Venganza, rápida y segura.", " Alguien tenía que responder por lo ocurrido.", " El dolor afila el golpe de {actor}."],
    failure: [" El dolor le roba la concentración a {actor}.", " {actor} aún tiene la mirada en el amigo caído.", " Las lágrimas nublan la puntería de {actor}.", " La venganza tendrá que esperar.", " La rabia y la pena vuelven descuidado a {actor}."]
  },
  protector: {
    success: [" {target} se aleja del amigo de {actor}.", " {actor} se interpone entre {target} y un aliado.", " Nadie toca a los amigos de {actor}.", " {actor} aparta la atención de {target} de los heridos.", " El aliado que hay detrás de {actor} respira un poco mejor."],
    failure: [" {target} sigue avanzando hacia el aliado de {actor}.", " {actor} no consigue apartar a {target} de su amigo.", " El aliado sigue en peligro.", " {target} ignora por completo a {actor}.", " Proteger a un amigo es más difícil de lo que parece."]
  },
  finishing: {
    success: [" Un golpe cruel y definitivo.", " De eso ya no hay forma de levantarse.", " Aquí no hay lugar para la piedad.", " {target} no tuvo ocasión de levantarse.", " Se acabó."],
    failure: [" Incluso indefenso, {target} de algún modo sobrevive.", " El destino perdona a {target}, por ahora.", " El golpe mortal se desvía.", " {target} se aferra a la vida.", " Todavía no."]
  },
  rival: {
    success: [" El duelo entre estos dos continúa.", " {actor} toma ventaja en su guerra particular.", " Otro punto para {actor}.", " {target} ya conoce bien a {actor}, y no basta.", " Esta rivalidad está lejos de terminar."],
    failure: [" {target} tiene bien medido a {actor}.", " De nuevo {target} lee a {actor} a la perfección.", " La rivalidad se inclina hacia {target}.", " {target} ya ha visto este movimiento.", " {actor} se frustra con este enemigo en particular."]
  }
};

const MOVE = {
  walk: {
    approach: ["{actor} carga hacia {target}.", "{actor} cruza a la carrera el espacio que le separa de {target}.", "{actor} avanza zigzagueando hacia {target}.", "{actor} salta una caja caída y se echa encima de {target}.", "{actor} se desliza agachando la cabeza hacia {target}."],
    terrain: ["{actor} se abre camino por {region}, con esfuerzo pero sin parar.", "{actor} avanza a trompicones por {region}, cada vez más cerca de {target}.", "{region} frena los pasos de {actor}.", "{actor} salta de roca en roca por {region}.", "{actor} cruza {region} con esfuerzo hacia {target}."],
    flee: ["{actor} da media vuelta y corre.", "{actor} sale disparado en busca de refugio.", "{actor} huye a trompicones, mirando atrás con miedo.", "{actor} echa a correr desesperadamente.", "{actor} se agacha y sale corriendo."],
    hunt: ["{actor} sale en busca de más presas.", "{actor} acecha a {target}.", "{actor} aún no ha terminado, y se vuelve hacia {target}.", "{actor} sale tras {target}.", "{actor} se acerca sigilosamente a {target}, que no sospecha nada."],
    help: ["{actor} corre a pedir ayuda.", "{actor} se escabulle para buscar a {target}.", "{actor} corre hacia {target}, haciendo señas y gritando.", "{actor} se zafa y va hacia {target}.", "{actor} sale corriendo a buscar a {target}."]
  },
  fly: {
    approach: ["{actor} se lanza en picado hacia {target}.", "{actor} cae desde lo alto sobre {target}.", "{actor} gira en el aire y baja hacia {target}.", "{actor} planea hacia {target}.", "{actor} bate las alas y se abalanza sobre {target}."],
    terrain: ["{actor} vuela sobre {region} sin preocupación alguna.", "{region} pasa bajo las alas de {actor}.", "{actor} roza {region} desde el aire.", "{actor} sobrevuela {region}, dejando atrás a los que van a pie.", "Sin que {region} le moleste, {actor} sigue planeando."],
    flee: ["{actor} alza el vuelo y huye.", "{actor} sube hacia el cielo y se aleja.", "{actor} vira y se pierde en la distancia.", "{actor} aletea frenéticamente fuera de alcance.", "{actor} se aleja volando."],
    hunt: ["{actor} vuela en círculos buscando a {target}.", "{actor} se lanza en vuelo tras {target}.", "{actor} divisa a {target} desde lo alto.", "{actor} se lanza en picado hacia {target}.", "{actor} planea hacia {target} con intención."],
    help: ["{actor} sale volando a buscar a {target}.", "{actor} vuela hacia {target}, llamando a gritos.", "{actor} vuela en busca de ayuda.", "{actor} cruza el aire a toda prisa hacia {target}.", "{actor} sale disparado hacia {target}."]
  },
  swim: {
    approach: ["{actor} corta el agua hacia {target}.", "{actor} avanza como un cuchillo hacia {target}.", "{actor} bracea con fuerza hacia {target}.", "{actor} cruza la corriente hacia {target}.", "{actor} se desliza bajo la superficie hacia {target}."],
    terrain: ["{actor} lucha contra el agua en {region}.", "{region} se agita alrededor de {actor}.", "{actor} patalea por {region}.", "{actor} cruza {region} con esfuerzo.", "{actor} se abre paso por {region}."],
    flee: ["{actor} se sumerge y se aleja nadando.", "{actor} desaparece bajo la superficie.", "{actor} se aleja chapoteando.", "{actor} se pone a salvo nadando.", "{actor} se escabulle bajo el agua."],
    hunt: ["{actor} se desliza tras {target}.", "{actor} rodea a {target} en el agua.", "{actor} se desliza por el agua tras {target}.", "{actor} caza a {target} bajo la superficie.", "{actor} nada hacia {target}."],
    help: ["{actor} se aleja nadando en busca de ayuda.", "{actor} bracea con fuerza hacia {target}.", "{actor} se dirige hacia {target}.", "{actor} sale a la superficie junto a {target}, gritando.", "{actor} se impulsa para ir a buscar a {target}."]
  },
  climb: {
    approach: ["{actor} trepa por encima para llegar a {target}.", "{actor} trepa por la pared hacia {target}.", "{actor} sube y se deja caer junto a {target}.", "{actor} escala el obstáculo hacia {target}.", "{actor} se encarama y salta, acercándose a {target}."],
    terrain: ["{actor} trepa por encima de {region} en lugar de cruzarla.", "{actor} sube por las rocas de {region}.", "{actor} elige un camino alto por {region}.", "{actor} trepa a través de {region}.", "{actor} encuentra asideros por todo {region}."],
    flee: ["{actor} trepa y se aleja.", "{actor} trepa fuera de alcance.", "{actor} desaparece por arriba.", "{actor} trepa a la desesperada.", "{actor} sube y sale de la pelea."],
    hunt: ["{actor} trepa tras {target}.", "{actor} escala la pared tras {target}.", "{actor} avanza por las alturas hacia {target}.", "{actor} se deja caer desde arriba hacia {target}.", "{actor} trepa hacia {target}."],
    help: ["{actor} trepa para ir a buscar a {target}.", "{actor} escala la pared, gritando el nombre de {target}.", "{actor} trepa en busca de ayuda.", "{actor} trepa hacia {target}.", "{actor} sube y cruza para encontrar a {target}."]
  },
  burrow: {
    approach: ["{actor} excava un túnel hacia {target}.", "El suelo se levanta mientras {actor} excava hacia {target}.", "{actor} desaparece bajo tierra y emerge cerca de {target}.", "{actor} cava hacia {target}.", "La tierra salta mientras {actor} perfora el suelo hacia {target}."],
    terrain: ["{actor} pasa por completo bajo {region}.", "{region} no significa nada para {actor}, bajo tierra.", "{actor} excava por debajo de {region}.", "{actor} cava bajo {region}.", "Sin que {region} le moleste, {actor} sigue cavando."],
    flee: ["{actor} se aleja excavando.", "{actor} desaparece bajo tierra.", "{actor} cava frenéticamente hasta perderse de vista.", "{actor} desaparece bajo la tierra.", "Solo un montículo de tierra marca por dónde se fue {actor}."],
    hunt: ["{actor} excava tras {target}.", "{actor} cava hacia {target}.", "El suelo ondula mientras {actor} caza a {target}.", "{actor} excava hacia {target}.", "{actor} desaparece rumbo a {target}."],
    help: ["{actor} se aleja excavando en busca de ayuda.", "{actor} excava un túnel hacia {target}.", "{actor} cava hacia {target}, llamando a gritos.", "{actor} desaparece en busca de {target}.", "{actor} perfora la tierra para encontrar a {target}."]
  }
};

const EVENT = {
  opening: ["Se desenvainan las armas y empieza la pelea.", "Durante un latido nadie se mueve. Luego, todos a la vez.", "El aire se detiene y después estalla.", "Comienza la batalla.", "Las miradas se cruzan sobre el campo, y empieza la pelea."],
  surprise: ["¡Salta la emboscada!", "Nadie lo vio venir.", "De la nada, llega el ataque.", "La sorpresa es total.", "El primer golpe cae antes de que nadie esté a punto."],
  down: ["{actor} se desploma.", "{actor} se derrumba en el suelo.", "{actor} cae, sin aliento.", "{actor} cae y no se levanta.", "{actor} se viene abajo con fuerza."],
  death: ["{actor} muere.", "{actor} cae para no levantarse nunca más.", "{actor} exhala por última vez.", "{actor} yace inmóvil para siempre.", "La lucha de {actor} ha terminado, para siempre."],
  finished: ["{by} acaba con {actor} allí donde yace.", "{by} remata a {actor}.", "Un último golpe de {by}, y {actor} ya no está.", "{by} se asegura de {actor}.", "Sin piedad: {by} remata a {actor}."],
  struckDown: ["Golpean de nuevo a {actor}, que ya estaba en el suelo.", "Golpean a {actor} sin que pueda defenderse.", "Ni en el suelo está a salvo {actor}.", "Otro golpe cae sobre {actor}, en el suelo.", "{actor} gime cuando cae el golpe."],
  recoveryGood: ["{actor} lucha por cada aliento y resiste.", "{actor} se aferra a la vida.", "La respiración de {actor} se calma un poco.", "{actor} se niega a rendirse.", "{actor} se mueve débilmente."],
  recoveryBad: ["{actor} se acerca un poco más a la muerte.", "La respiración de {actor} se vuelve débil.", "{actor} se apaga.", "{actor} palidece y se queda quieto.", "La vida se le escapa a {actor}."],
  firstAid: ["{actor} se arrodilla junto a {target} y detiene la hemorragia.", "{actor} venda las heridas de {target}; {target} vivirá.", "{actor} trabaja deprisa, y la respiración de {target} se calma.", "{actor} impide que {target} se le escape.", "Con pulso firme, {actor} saca a {target} del borde."],
  firstAidFail: ["{actor} atiende a {target}, pero la hemorragia no se detiene.", "A {actor} se le enredan las vendas mientras {target} se apaga.", "{actor} intenta ayudar a {target}, de momento sin éxito.", "{actor} presiona las heridas de {target}, pero no basta.", "{actor} no consigue estabilizar a {target}, aún no."],
  aftermathAlone: ["La lucha ha terminado. Nadie acude a por los caídos.", "Se hace el silencio, y los caídos quedan a su suerte.", "Los vencedores no prestan atención a los caídos.", "Se acabó, y los heridos están solos.", "No llega ninguna ayuda; los caídos libran ahora su propia batalla."],
  aftermath: ["La lucha ha terminado, pero no el peligro.", "Mientras se asienta el polvo, los supervivientes se vuelven hacia sus caídos.", "Silencio, y luego la urgencia de mantener vivos a los amigos.", "Sin enemigos a la vista no hay tiempo para descansar: alguien se muere.", "Cae el último enemigo, y los supervivientes corren hacia los heridos."],
  stabilize: ["{actor} se estabiliza; sin sentido, pero con vida.", "La respiración de {actor} se calma; el peligro ha pasado por ahora.", "{actor} vivirá, aunque sigue sin sentido.", "{actor} deja de escaparse.", "{actor} cae en un sueño profundo, pero con vida."],
  heal: ["{actor} atiende a {target} y le cura las heridas.", "La magia de {actor} cierra la carne de {target}.", "{actor} canaliza curación hacia {target}.", "{actor} remienda a {target} en pleno caos.", "Una luz cálida fluye de {actor} hacia {target}."],
  healSelf: ["{actor} recupera el aliento y se cura las heridas.", "{actor} se cura.", "{actor} se recompone y se recupera.", "{actor} se rehace.", "{actor} devuelve la fuerza a su propio cuerpo."],
  potion: ["{actor} se bebe una poción de un trago.", "{actor} apura un brebaje curativo.", "{actor} bebe a fondo de un vial y le vuelve el color.", "{actor} se bebe una poción de golpe.", "{actor} vacía un frasco y se siente mejor."],
  revive: ["¡{actor} saca a {target} del abismo!", "{target} despierta con un jadeo bajo los cuidados de {actor}.", "{actor} devuelve la consciencia a {target}.", "Los ojos de {target} se abren de golpe cuando la curación de {actor} hace efecto.", "{actor} se niega a perder a {target}, y {target} despierta."],
  stand: ["{actor} se vuelve a levantar.", "{actor} se pone en pie tambaleándose.", "{actor} se levanta.", "{actor} se empuja desde el suelo.", "{actor} se incorpora a toda prisa."],
  shield: ["{actor} alza un escudo.", "{actor} afianza su escudo.", "{actor} se agazapa tras el escudo.", "{actor} se protege tras el escudo.", "{actor} levanta el escudo y espera."],
  draw: ["{actor} empuña {weapon}.", "{actor} prepara {weapon}.", "El acero resuena cuando {actor} desenvaina {weapon}.", "{actor} saca {weapon}.", "{actor} tiene {weapon} a mano."],
  prone: ["Derriban a {actor}.", "{actor} sale despedido por los suelos.", "Arrastran a {actor} al suelo.", "{actor} da con sus huesos en el suelo.", "{actor} cae rodando."],
  grabbed: ["{by} atrapa a {actor}.", "{by} agarra a {actor}.", "{actor} queda en las garras de {by}.", "{by} inmoviliza a {actor}.", "{actor} forcejea en la presa de {by}."],
  escape: ["{actor} se libera de un tirón.", "{actor} se zafa retorciéndose.", "{actor} rompe la presa.", "{actor} se escurre del agarre.", "{actor} se suelta."],
  stuck: ["{actor} forcejea, pero no consigue soltarse.", "{actor} tira contra la presa.", "La presa sobre {actor} aguanta.", "{actor} se revuelve en vano.", "{actor} sigue bien sujeto."],
  waver: ["El valor de {actor} flaquea.", "{actor} mira hacia las salidas.", "La duda cruza el rostro de {actor}.", "{actor} vacila.", "A {actor} empiezan a temblarle las manos."],
  intercept: ["{actor} se lanza en el camino del ataque de {target}.", "{actor} se interpone y recibe el golpe que {target} destinaba a un amigo.", "{target} golpea, pero de pronto {actor} está en medio.", "{actor} interpone su cuerpo entre {target} y un aliado.", "{actor} para el golpe de {target} con su propia armadura."],
  holdGround: ["Todo el instinto de {actor} le grita que huya; {actor} se planta en cambio.", "{actor} mira las salidas, aprieta los dientes y se queda.", "{actor} no huirá. Hoy no.", "{actor} se sacude las ganas de huir y aguanta.", "{actor} da un paso atrás, y ni uno más."],
  flee: ["{actor} se derrumba y huye.", "{actor} ya ha tenido bastante y huye.", "{actor} sale huyendo.", "{actor} sale corriendo.", "{actor} abandona la pelea."],
  answerCall: ["{target} pide ayuda a {actor}.", "«¡{actor}, te necesito!», grita {target}.", "{target} mira a {actor}, y {actor} responde.", "A la llamada de {target}, {actor} se vuelve para ayudar.", "{target} pide a {actor} una ventaja."],
  edgeFails: ["{actor} intenta preparar el terreno para {target}, pero no sale nada.", "{actor} grita para ayudar a {target}, pero no sirve de nada.", "El intento de {actor} de dar ventaja a {target} se queda en nada.", "{actor} intenta abrirle camino a {target}, y fracasa.", "{actor} intenta ayudar a {target}, pero solo estorba."],
  edgeFailsSelf: ["{actor} busca una abertura, y no la encuentra.", "{actor} intenta tomar ventaja, y fracasa.", "{actor} busca la ventaja, pero el momento pasa.", "El intento de {actor} de preparar algo se queda en nada.", "{actor} espera una abertura que nunca llega."],
  studyFails: ["{actor} estudia a {target}, pero no saca nada útil.", "{actor} observa a {target} y no consigue entenderle.", "{actor} rebusca en su memoria algo sobre {target}, y no encuentra nada.", "{target} no le da a {actor} nada con lo que trabajar.", "{actor} calibra a {target}, y se equivoca."],
  scheme: ["{actor} mira a {target} y se pregunta lo fácil que sería librarse de {target}.", "{actor} ve a {target} dar órdenes y piensa que podría hacerlo mejor.", "Una idea cruza la mente de {actor}: sin {target}, ¿quién mandaría?", "{actor} sopesa lo que supondría la caída de {target}.", "{actor} mira a {target} con algo más frío que la lealtad."],
  commandTakes: ["Con {target} fuera de combate, {actor} toma el mando.", "{actor} da un paso al frente para mandar en lugar de {target}.", "{actor} da las órdenes ahora que {target} no puede.", "«¡Conmigo!», grita {actor}, sin {target}.", "{actor} toma el relevo donde lo dejó {target}."],
  commandTakesFresh: ["{actor} toma el mando.", "{actor} da un paso al frente para mandar.", "{actor} empieza a dar órdenes a gritos.", "«¡Conmigo!», grita {actor}.", "{actor} se pone al frente."],
  commandBack: ["{actor} vuelve a tomar el mando.", "{actor} vuelve a estar al frente.", "La voz de {actor} vuelve a imponerse sobre las demás.", "{actor} recupera el mando.", "{actor} vuelve a tomar las riendas."],
  commandLost: ["Sin {actor}, no queda nadie que los dirija.", "Nadie da un paso al frente tras {actor}.", "Sin {actor}, siguen luchando cada cual por su cuenta.", "{actor} cae, y su bando se queda sin líder.", "Nadie ocupa el lugar de {actor}."],
  shareLore: ["{actor} cuenta a {allies} lo que sabe de {target}.", "«¡Cuidado con su lado izquierdo!», avisa {actor} a {allies}, estudiando a {target}.", "{actor} explica a {allies} cómo enfrentarse a {target}.", "{actor} comparte con {allies} lo que ha visto de {target}.", "{actor} señala a {allies} los puntos débiles de {target}."],
  observe: ["{actor} se contiene y observa de cerca a {targets}.", "{actor} no dice nada y toma la medida a {targets}.", "{actor} se queda atrás y estudia a {targets}.", "Mientras los demás hablan, {actor} observa a {targets}.", "{actor} guarda silencio, con la mirada puesta en {targets}."],
  study: ["{actor} estudia a {target}, buscando puntos débiles.", "{actor} observa a {target} con atención.", "{actor} recuerda todo lo que se sabe de {target}.", "{actor} calibra a {target}.", "{actor} rebusca en su memoria cómo vencer a {target}."],
  parley: ["{actor} alza la voz, intentando hablar.", "{actor} levanta una mano y pide paz a gritos.", "{actor} intenta razonar, pero nadie le entiende.", "{actor} pide una tregua.", "{actor} prueba primero con palabras."],
  callHelp: ["¡{actor} pide ayuda a gritos a {target}!", "{actor} llama a voces a {target}.", "{actor} llama a {target} a las armas.", "«¡Ayuda!», grita {actor} a {target}.", "{actor} despierta a {target} con un grito desesperado."],
  noticeSight: ["{actor} ve la pelea.", "{actor} se da cuenta del alboroto.", "{actor} alza la vista hacia la violencia.", "{actor} divisa la batalla.", "{actor} se vuelve hacia la lucha."],
  noticeSound: ["{actor} oye los sonidos de la batalla.", "El choque del acero llega hasta {actor}.", "{actor} oye gritos cerca.", "Unos gritos lejanos llegan hasta {actor}.", "{actor} aguza el oído ante el ruido."],
  noticeFled: ["{by} tropieza de lleno con {actor}.", "{by}, en plena huida, casi arrolla a {actor}.", "{by} se cruza de golpe en el camino de {actor}.", "{by} pasa corriendo y sobresalta a {actor}.", "{by} huye justo por delante de {actor}."],
  noticeHelp: ["{actor} responde a la llamada de {by}.", "{actor} oye el grito de auxilio de {by}.", "El grito de {by} llega hasta {actor}.", "{by} pone en pie a {actor}.", "{actor} oye a un amigo llamar."],
  noticeAttacked: ["Atacan a {actor} sin aviso.", "{by} cae sobre {actor}, que no sospechaba nada.", "{actor} no tiene ningún aviso antes de que {by} ataque.", "{by} sorprende por completo a {actor}.", "{by} tiende una emboscada a {actor}."],
  join: ["{actor} se une a la pelea.", "{actor} carga.", "{actor} empuña un arma y entra en la refriega.", "{actor} se mete en la lucha.", "{actor} corre a unirse a la batalla."],
  joinForced: ["{actor} no tiene más remedio que luchar.", "Arrastran a {actor} a la batalla.", "{actor} tiene que defenderse.", "A {actor} no le queda otra que pelear.", "{actor} devuelve los golpes."],
  watch: ["{actor} se queda atrás, mirando.", "{actor} guarda las distancias.", "{actor} observa desde los márgenes.", "{actor} aún no está a punto de meterse.", "{actor} espera a ver cómo va."],
  leave: ["{actor} no quiere saber nada y se escabulle.", "{actor} se va sin hacer ruido.", "{actor} retrocede y desaparece.", "{actor} decide que esta no es su pelea.", "{actor} se funde con las sombras."],
  standoff: ["Las manos rondan las armas, pero nadie desenvaina. Aún no.", "Los dos bandos se miran cara a cara, y alguien empieza a hablar.", "La tensión chisporrotea en el aire; primero, las palabras.", "Nadie quiere ser quien golpee primero.", "Un enfrentamiento tenso: cada mirada clavada en cada mano."],
  breakStandoff: ["¡{actor} ya ha oído bastante y echa mano al arma!", "La paciencia de {actor} se rompe, y sale el acero.", "Se acabó hablar: {actor} ataca.", "{actor} decide que las palabras han fracasado.", "{actor} se lanza, y el enfrentamiento salta en pedazos."],
  breakBeast: ["¡{actor} no espera más y se lanza!", "{actor} gruñe y carga.", "{actor} no tiene paciencia para palabras y salta.", "Con un gruñido, {actor} ataca.", "{actor} eriza el lomo y salta."],
  bribed: ["{actor} acepta {amount} de {target} y se lleva a su gente.", "{target} paga {amount} a {actor}; {actor} se lo guarda y se va, con todos los suyos.", "{amount} compran a {actor}: se va, y su gente con {actor}.", "{actor} sopesa los {amount} de {target}, sonríe y retira a su gente.", "Con {amount} de {target} en el bolsillo, {actor} se marcha y se lleva al resto."],
  retreatCall: ["¡{actor} ordena la retirada!", "«¡Atrás!», grita {actor}.", "{actor} da la señal de retirada.", "{actor} ya ha visto bastante: «¡Todos atrás!».", "{actor} ordena retirarse."],
  retreatUrged: ["A instancias de {target}, {actor} ordena la retirada.", "{target} suplica a {actor} que se retiren, y {actor} accede: «¡Atrás!».", "{actor} hace caso a {target} y ordena la retirada.", "{target} busca la mirada de {actor}; {actor} asiente y ordena la retirada.", "Presionado por {target}, {actor} da la orden de replegarse."],
  retreatRefused: ["{actor} no quiere oír hablar de retirada: {target} tiene que aguantar.", "«¡Mantén la posición!», le espeta {actor} a {target}.", "{target} quiere irse; {actor} no lo permite.", "{actor} corta en seco a {target}: aquí no huye nadie.", "{actor} rechaza la súplica de {target} de replegarse."],
  holdOrdered: ["{actor} se traga el miedo y aguanta, como le ordenan.", "{actor} no se mueve, como manda {target}.", "Con la orden de aguantar, {actor} aguanta.", "{actor} aprieta los dientes y mantiene la línea.", "{actor} obedece a {target} y se queda."],
  fallBack: ["{actor} se repliega con {target}.", "{actor} sigue a {target} fuera de la pelea.", "{actor} se retira junto a {target}.", "{actor} rompe el contacto y se va con {target}.", "{actor} se retira con el resto, tras {target}."],
  leadRetreat: ["{actor} encabeza la retirada.", "{actor} da media vuelta y se lleva a los demás.", "{actor} dirige la retirada.", "{actor} saca de allí a su gente.", "{actor} va en cabeza, haciendo señas a los demás para que le sigan."],
  rally: ["{actor} arenga a {allies}: ¡a aguantar!", "«¡Firmes!», grita {actor} a {allies}.", "{actor} da ánimos a {allies}.", "{actor} mantiene unidos a {allies}.", "{actor} brama a {allies} que mantengan la línea."],
  breakAnnoyed: ["¡{actor} culpa al otro bando y ataca!", "{actor} ya ha tenido bastante de los amigos del otro bando, y golpea.", "{actor} decide quién está detrás de esto, y va a por ellos.", "Echando humo contra el otro bando, {actor} desenvaina.", "{actor} lo paga con el otro bando."],
  breakBlood: ["Corre la sangre entre los dos bandos: se acabó el enfrentamiento.", "El golpe de {actor} cruza el enfrentamiento, y ahora es una pelea.", "El enfrentamiento se rompe cuando {actor} golpea al otro bando.", "{actor} hace sangre, y se acaba la conversación.", "Un golpe de {actor}, y todos desenvainan."],
  breakInsulted: ["¡{actor} se toma las palabras como un insulto y ataca!", "Herido en su orgullo, {actor} responde con el acero.", "El rostro de {actor} se ensombrece, y sale el filo.", "Esa fue una palabra de más para {actor}.", "Con el orgullo herido, {actor} golpea."],
  standDown: ["{actor} baja el arma y retrocede.", "{actor} acepta retirarse.", "{actor} asiente despacio y lo deja estar.", "Convencido por {by}, {actor} se echa atrás.", "{actor} decide que esto no merece una pelea."],
  peace: ["Termina sin un solo golpe: las palabras lo resuelven.", "Las armas siguen envainadas; la cuestión se zanja hablando.", "No se derrama ni una gota de sangre.", "Se imponen las cabezas frías, y todos se marchan.", "El enfrentamiento termina con palabras, no con heridas."],
  talksStall: ["La negociación se alarga sin final a la vista.", "Ningún bando cede terreno, y nadie desenvaina.", "Las palabras dan vueltas; nada se resuelve.", "Tablas a base de palabras.", "El enfrentamiento simplemente continúa."],
  noticeStandoff: ["{actor} se da cuenta del tenso enfrentamiento.", "Unas voces airadas llaman la atención de {actor}.", "{actor} ve que se está fraguando un enfrentamiento.", "{actor} oye una discusión cerca.", "{actor} observa el enfrentamiento con interés."],
  paidOff: ["{actor} paga {amount} a {by} para que no se meta.", "{actor} compra a {by} con {amount}.", "{amount} cambian de manos: ahora {by} se mantiene al margen.", "{actor} cuenta {amount} para {by}, que se lo guarda.", "{by} acepta los {amount} de {actor} y mira hacia otro lado."],
  paidKept: ["{actor} le promete {item} a {by}, y de algún modo se lo queda.", "{actor} regatea con {by} hasta dejarlo en nada.", "{actor} ofrece {item}; {by} lo rechaza con un gesto.", "{by} deja que {actor} se quede {item}, por ahora.", "La suerte acompaña a {actor}: {by} no se lleva nada."],
  paidNothing: ["{actor} no tiene nada que dar a {by}.", "{actor} le enseña a {by} los bolsillos vacíos.", "{actor} se encoge de hombros ante {by}: no hay nada que dar.", "{by} no saca nada de {actor}.", "{actor} vuelve la bolsa del revés: vacía."],
  concedeMoney: ["{actor} entrega {amount} a {by}.", "{actor} cuenta a regañadientes {amount} para {by}.", "{actor} paga {amount} a {by} para acabar con esto.", "{amount} cambian de manos, de {actor} a {by}.", "{actor} le lanza una bolsa a {by}: {amount}."],
  concedeItem: ["{actor} entrega {item} a {by}.", "{actor} le pasa {item} a {by}.", "{actor} cede {item} a {by}.", "{by} se marcha con {item}, de {actor}.", "{actor} deja que {by} se lleve {item}."],
  concedeKept: ["{actor} acepta entregar {item}, pero de algún modo lo conserva.", "{actor} echa mano a {item}, y la fortuna sonríe: {by} lo rechaza con un gesto.", "{actor} promete {item} a {by}, y el momento pasa.", "{actor} ofrece {item}; al final {by} no lo acepta.", "La suerte acompaña a {actor}: {item} se queda donde estaba."],
  lieAndRun: ["{actor} jura que no tiene nada y sale corriendo.", "«¡No tengo nada!», grita {actor}, y huye.", "{actor} enseña las manos vacías, protesta y huye.", "{actor} miente descaradamente y corre.", "{actor} insiste en que no tiene un céntimo, y se larga."],
  lastWord: ["{actor} alza una mano: una oportunidad más para arreglar esto.", "«Esperen», dice {actor}. «Seamos sensatos.»", "{actor} da un paso al frente antes de que corra la sangre.", "{actor} tiene una última palabra.", "{actor} contiene a los suyos y hace una última oferta."],
  conditionRider: ["{actor} queda {effect}.", "El golpe deja a {actor} {effect}.", "{actor} se tambalea: {effect}.", "{actor} sale {effect} de ello.", "Eso deja a {actor} {effect}."],
  controlTakes: ["{su} {weapon} de {actor} hace efecto: {target} queda {effect}.", "{actor} atrapa a {target} con {su} {weapon}: {effect}.", "{actor} envuelve a {target} con {su} {weapon}, que queda {effect}.", "{target} lucha contra {su} {weapon} de {actor}, pero acaba {effect}.", "{actor} trabaja con {su} {weapon} sobre {target}: {effect}."],
  controlResisted: ["{target} se sacude {su} {weapon} de {actor}.", "{actor} lanza {su} {weapon} sobre {target}, sin efecto.", "{target} se libera de {su} {weapon} de {actor}.", "{su} {weapon} de {actor} se apaga contra {target}.", "{target} no se deja atar por {su} {weapon} de {actor}."],
  buffOne: ["{actor} lanza {su} {weapon} sobre {target}: {effect}.", "{actor} se vuelve hacia {target}, y {weapon}: {effect}.", "Con {weapon}, {actor} deja a {target} {effect}.", "{target} nota cómo {su} {weapon} de {actor} hace efecto: {effect}.", "{actor} presta {weapon} a {target}: {effect}."],
  buffMany: ["{actor} extiende {su} {weapon} sobre {targets}: {effect}.", "{actor} alza {su} {weapon} sobre {targets}: {effect}.", "{targets} notan cómo {su} {weapon} de {actor} hace efecto: {effect}.", "{actor} invoca {weapon} para {targets}: {effect}.", "{su} {weapon} de {actor} alcanza a {targets}: {effect}."],
  buffWithSelf: ["{actor} extiende {su} {weapon} sobre {all}: {effect}.", "{actor} invoca {weapon}: {all}, {effect}.", "{weapon} se alza alrededor de {all}: {effect}.", "{all} notan cómo {su} {weapon} de {actor} hace efecto: {effect}.", "{actor} alza {weapon} sobre el grupo: {all}, {effect}."],
  dodge: ["{actor} se mantiene ligero de pies, listo para esquivar.", "{actor} renuncia a atacar y se concentra en que no le den.", "{actor} se agacha y zigzaguea, sin dejarse atrapar.", "{actor} se repliega en la pura defensa.", "{actor} convierte cada movimiento en una esquiva."],
  reckless: ["{actor} deja de lado la prudencia y golpea con todo.", "{actor} baja la guardia para poner más en cada golpe.", "{actor} ataca sin cuidado, retando a cualquiera a devolver el golpe.", "{actor} lo apuesta todo, al diablo la defensa.", "{actor} ruge y abandona toda precaución."],
  surge: ["{actor} supera sus límites por un momento.", "{actor} encuentra un arranque de velocidad y sigue.", "{actor} se lanza adelante, más rápido de lo que parece posible.", "{actor} saca fuerzas de flaqueza y vuelve a actuar.", "{actor} no para; sigue en un torbellino."],
  buffSelf: ["{actor} se envuelve en {weapon}: {effect}.", "{actor} invoca {weapon}: {effect}.", "{actor} recurre a {weapon}: {effect}.", "{weapon} se posa sobre {actor}: {effect}.", "{actor} se prepara con {weapon}: {effect}."],
  controlBackfire: ["{actor} prueba {su} {weapon} con {target} y es quien acaba {effect}.", "{su} {weapon} de {actor} sale mal; quien acaba {effect} es {actor}.", "{target} le da la vuelta a {su} {weapon} de {actor}, que acaba {effect}.", "{actor} se excede con {weapon} y acaba {effect}.", "{weapon} se vuelve contra {actor}: {effect}."],
  concentrationLost: ["La concentración de {actor} se rompe, y {weapon} se desvanece.", "El golpe rompe la concentración de {actor}; {weapon} se le escapa.", "{actor} pierde el control de {weapon}.", "{weapon} se apaga cuando falla la concentración de {actor}.", "{actor} ya no puede mantener {weapon}."],
  allegianceTurn: ["{actor} se vuelve contra su propio bando, con la voluntad de {by} en la mirada.", "Bajo el control de {by}, {actor} se revuelve contra sus amigos.", "La mirada de {actor} se queda vacía; ahora manda {by}.", "{actor} cambia de bando, marioneta de {by}.", "El dominio de {by} se apodera de {actor}, que se vuelve contra sus compañeros."],
  allegianceBack: ["{actor} recupera el sentido.", "{actor} sacude la cabeza, libre del dominio.", "El hechizo se rompe, y {actor} vuelve a ser quien era.", "{actor} parpadea, horrorizado por lo ocurrido, y vuelve a su bando.", "{actor} se quita de encima el control y vuelve con sus amigos."],
  knockout: ["{by} deja a {actor} sin sentido de un golpe.", "{by} tumba a {actor} sin matarle.", "{actor} cae, sin sentido pero con vida.", "{by} contiene el último golpe; {actor} se desploma, sin sentido.", "{actor} se derrumba, fuera de combate."],
  executeSpared: ["{actor} se planta junto a {target}, en el suelo, y luego se vuelve para enfrentarse a {next}.", "{actor} alza el arma sobre {target}, y se lo piensa mejor: {next} es la verdadera amenaza.", "{actor} deja a {target} donde cayó y va a por {next}.", "Algo hace que {actor} perdone a {target}; se revuelve contra {next}.", "{actor} pasa por encima de {target} sin un segundo golpe, con la vista en {next}."],
  executeSparedAlone: ["{actor} se planta junto a {target}, en el suelo, y luego se da la vuelta.", "{actor} alza el arma sobre {target}, y la vuelve a bajar.", "{actor} deja a {target} donde cayó.", "Algo detiene la mano de {actor}; {target} se salva.", "{actor} mira a {target}, en el suelo, y se aleja."],
  executeGoes: ["{actor} se planta junto a {target}, en el suelo, y pretende acabar con esto.", "{actor} se vuelve contra {target}, sin defensa.", "{actor} no ha terminado con {target}.", "{actor} se acerca a {target}, en el suelo, para rematarle.", "En {actor} no hay piedad para {target}."],
  deed: ["¡La hazaña de {actor} da en el blanco: {target} queda {effect}!", "{actor} realiza {weapon}, y {target} queda {effect}.", "¡Una proeza de armas! {actor} deja a {target} {effect}.", "{su} {weapon} de {actor} funciona: {target} queda {effect}.", "Con una floritura, {actor} deja a {target} {effect}."],
  riderTakes: ["{actor} pone {weapon} en el golpe: {target} queda {effect}.", "Con {weapon}, {actor} deja a {target} {effect}.", "{target} recibe {weapon} de {actor} y queda {effect}.", "Con {weapon}, {actor} deja a {target} {effect}.", "{actor} remata con {weapon}; {target} queda {effect}."],
  critEffect: ["El golpe deja a {actor} {effect}.", "{actor} se tambalea por el golpe demoledor: {effect}.", "El golpe de {by} deja a {actor} {effect}.", "El terrible golpe deja a {actor} {effect}.", "Un golpe salvaje: {actor} queda {effect}."],
  fumble: ["{actor} la pifia de mala manera.", "El ataque de {actor} sale fatal.", "{actor} tropieza con sus propios pies.", "Un golpe torpe deja a {actor} sin equilibrio.", "{actor} lo echa todo a perder."],
  fumbleEffect: ["{actor} la pifia y acaba {effect}.", "El ataque de {actor} sale mal, y {actor} queda {effect}.", "Un golpe torpe, y {actor} queda {effect}.", "{actor} la pifia del todo: {effect}.", "{actor} tropieza con su propio ataque y queda {effect}."],
  spellFails: ["{su} {weapon} de {actor} se apaga sin más.", "{actor} se enreda con las palabras de {weapon}; no pasa nada.", "La magia de {weapon} se le escapa a {actor} de las manos.", "{actor} busca {weapon}, y no llega.", "{weapon} le falla a {actor}."],
  spellLost: ["{su} {weapon} de {actor} se apaga, y el conjuro se le borra de la mente.", "{weapon} se le escapa a {actor}; hoy no volverá.", "{actor} pierde {weapon}: las palabras se han ido.", "El conjuro falla, y {actor} siente cómo {weapon} se le escapa de la memoria.", "{weapon} se desmorona; {actor} tardará en volver a lanzarlo."],
  disapproval: ["El dios de {actor} hace oídos sordos a {weapon}.", "{actor} invoca {weapon} y siente en su lugar el desagrado divino.", "El cielo calla: {weapon} de {actor} queda sin respuesta.", "La súplica de {actor} por {weapon} solo encuentra desaprobación.", "La deidad de {actor} no está contenta; {weapon} falla."],
  boost: ["{actor} quema {label} para que cuente.", "{actor} confía en {label}, y lo gasta.", "La fortuna se pliega ante {actor}, a cambio de {label}.", "{actor} tira de {label}.", "{actor} gasta {label} en el momento."],
  boostFor: ["{actor} quema {label} por {target}.", "{actor} presta su {label} a {target}.", "{label} de {actor} vuelve la fortuna hacia {target}.", "{actor} gasta {label} en nombre de {target}.", "Un poco de {label} de {actor} va para {target}."],
  fateSelf: ["{actor} gasta {label} y engaña a la muerte.", "{actor} recurre a {label}; la muerte tendrá que esperar.", "{label} saca adelante a {actor}.", "{actor} aún no ha terminado: {label} se encarga de ello.", "Al borde del abismo, {actor} gasta {label}."],
  fateFor: ["{actor} gasta {label} para salvar a {target}.", "{label} de {actor} mantiene con vida a {target}.", "{actor} renuncia a {label} por {target}.", "{target} vive, gracias a {label} de {actor}.", "{actor} no dejará morir a {target}, y gasta {label}."],
  bodyAlive: ["Dan la vuelta a {actor}, y {actor} jadea. No había muerto, después de todo.", "{actor} solo estaba sin sentido; vuelve en sí, a duras penas.", "Contra todo pronóstico, {actor} se mueve.", "Los amigos de {actor} encuentran pulso: vive.", "{actor} tose y abre los ojos. Qué suerte."],
  bodyDead: ["Los amigos de {actor} llegan hasta el cuerpo, pero no hay nada que hacer.", "{actor} se ha ido de verdad.", "Ningún aliento se mueve en {actor}.", "Examinan a {actor}, y niegan con la cabeza.", "La suerte de {actor} se ha agotado."],
  reactHit: ["{actor} responde al golpe con {weapon}.", "Justo a tiempo, {actor} recurre a {weapon}.", "{actor} recibe el golpe de {target} con {weapon}.", "{weapon}: a {actor} no le toman por sorpresa.", "{actor} reacciona en un instante: {weapon}."],
  reactAttacked: ["{actor} ve venir a {target} y se aparta.", "{actor} se escurre del golpe de {target}.", "{actor} lee el ataque de {target} y lo esquiva.", "{actor} se aparta de la línea de {target}.", "{actor} ya se está moviendo cuando {target} golpea."],
  reactMissed: ["{target} se estira de más, y {actor} se lo hace pagar.", "{actor} convierte el fallo de {target} en una abertura.", "{target} falla por mucho; {actor} contraataca al instante.", "{actor} castiga el fallo de {target}.", "{actor} responde al fallo con el acero."],
  reactDamaged: ["Con la herida aún fresca, {actor} contraataca a {target} con {weapon}.", "{actor} responde al golpe de {target} con {weapon}.", "{actor} le devuelve el dolor a {target}: {weapon}.", "{target} hirió a {actor}, y llega {weapon}.", "{actor} gruñe y descarga {weapon} sobre {target}."],
  counterTakes: ["{su} {weapon} de {actor} deshace {spell} de {target}.", "{spell} de {target} muere en el aire: {weapon} de {actor}.", "{actor} apaga {spell} de {target} con {weapon}.", "{target} da forma a {spell}, y {actor} lo hace pedazos.", "{actor} responde a {spell} de {target} con {weapon}, y desaparece."],
  counterFails: ["{su} {weapon} de {actor} no puede detener {spell} de {target}.", "{spell} de {target} atraviesa {weapon} de {actor}.", "{actor} recurre a {weapon} demasiado tarde; {spell} de {target} sale adelante.", "{su} {weapon} de {actor} vacila contra {spell} de {target}.", "Demasiado poder: {spell} de {target} atraviesa {weapon} de {actor}."],
  summonOne: ["{actor} invoca {weapon}, y {name} aparece para luchar a su lado.", "Con {weapon}, {actor} trae a {name} a la pelea.", "{name} responde a {weapon} de {actor}.", "{su} {weapon} de {actor} hace surgir a {name} de la nada.", "{name} toma forma a la llamada de {actor}."],
  summonMany: ["{actor} invoca {weapon}: responden {names}.", "Con {weapon}, {actor} trae a {names} a la pelea.", "{names} acuden a la llamada de {actor}.", "{su} {weapon} de {actor} llena el campo de {names}.", "{names} toman forma alrededor de {actor}."],
  vanish: ["{actor} se desvanece.", "{actor} desaparece, como si nunca hubiera existido.", "{actor} se disuelve en la nada.", "La magia que sostenía a {actor} se agota.", "{actor} se esfuma."],
  mercy: ["{actor} se planta junto a {target}: nadie le remata.", "{actor} no dejará que nadie mate a {target}.", "«Basta.» {actor} mantiene a los demás lejos de {target}.", "{actor} protege a {target}, en el suelo, del resto.", "{actor} insiste en que {target} siga con vida."],
  shakeOff: ["{actor} se sacude: ya no {effect}.", "{actor} se libra de lo que le tenía {effect}.", "{actor} se quita de encima el efecto: {effect}.", "{actor} ya no está {effect}.", "{actor} se libera: ya no está {effect}."],
  controlImmune: ["{su} {weapon} de {actor} no significa nada para {target}.", "{target} sale intacto de {su} {weapon} de {actor}; nunca iba a funcionar.", "{actor} desperdicia {weapon} en {target}.", "{weapon} resbala por completo sobre {target}.", "{target} ni siquiera nota {weapon} de {actor}."],
  theftSuccess: ["{actor} le quita {amount} a {target} sin que lo note.", "Dedos ágiles: {actor} alivia a {target} de {amount}.", "{actor} roza a {target} al pasar y se lleva {amount}.", "{target} no nota cómo {actor} le quita {amount}.", "{actor} se embolsa {amount} de {target} en plena refriega."],
  theftEmpty: ["Los dedos de {actor} no encuentran nada que valga la pena en {target}.", "{actor} busca la bolsa de {target} y no la encuentra.", "{actor} registra los bolsillos de {target} y no encuentra nada a su alcance.", "{actor} se aleja de {target} con las manos vacías.", "Las pertenencias de {target} siguen en su sitio, pese a los esfuerzos de {actor}."],
  feintMiss: ["{actor} finta contra {target} con {weapon}, pero no consigue acercarse lo suficiente.", "La finta de {actor} con {weapon} no engaña a nadie.", "{target} mantiene a raya a {actor} y {weapon}.", "{actor} intenta una finta, pero {target} no pica.", "La finta de {actor} con {weapon} se queda lejos."],
  theftFeint: ["{actor} finta con {weapon} y, con el mismo gesto, le quita {amount} a {target}.", "Un amago inofensivo con {weapon}, y {amount} desaparecen del cinto de {target}.", "{actor} atrae la mirada de {target} con {weapon} y se lleva {amount}.", "Mientras {target} para {weapon} de {actor}, desaparecen {amount}.", "{weapon} de {actor} solo era una distracción: {amount} cambian de manos."],
  theftCaught: ["¡{target} sorprende la mano de {actor} en su mochila!", "Sorprenden a {actor} intentando robar a {target}.", "{target} aparta de un manotazo la mano de {actor}, con furia.", "¡Ahí está! {target} ve a {actor} echar mano a sus cosas.", "{actor} estropea el robo, y {target} lo sabe."],
  reclaim: ["{actor} recupera {amount} de {by}, en el suelo.", "{actor} recupera {amount} de {by}.", "{actor} reclama {amount}.", "Con {by} vencido, {amount} vuelven a {actor}.", "{actor} le arranca {amount} a {by}."],
  dealStruck: ["Se paga un precio, y cada cual sigue su camino.", "Se cierra el trato; no se derrama sangre.", "Monedas y objetos cambian de manos, y se acaba el enfrentamiento.", "Termina con un trato, no con una batalla.", "Alguien cede algo, y el asunto queda zanjado."],
  backedOff: ["Un bando se retira, y termina sin un solo golpe.", "Alguien decide que no merece la pena y se va.", "Puestos contra las cuerdas, se retiran, y termina el enfrentamiento.", "Ceden terreno y se van; nadie desenvaina.", "Termina con una retirada, no con una pelea."],
  surrender: ["{actor} arroja el arma y se rinde.", "{actor} cae de rodillas y se rinde.", "{actor} levanta las manos vacías.", "{actor} abandona la pelea.", "{actor} se rinde ante {by}."],
  swayFlee: ["{actor}, convencido por {by}, huye.", "{actor} sigue el consejo de {by} y se va.", "{actor} retrocede y echa a correr.", "{actor} decide vivir un día más.", "{actor} se escabulle, convencido."],
  switch: ["¡{actor} se vuelve contra sus antiguos aliados!", "{actor} cambia de bando, convencido por {by}.", "{actor} lucha ahora junto a {by}.", "{actor} cambia de lealtad en plena batalla.", "{actor} se une a {by}."],
  recruit: ["{by} se gana a {actor}, que se une a su bando.", "Persuadido, {actor} se pone del lado de {by}.", "{actor} le hace un gesto a {by}: se apunta.", "{actor} por fin elige bando: el de {by}.", "{by} tiene un nuevo aliado en {actor}."],
  standAside: ["{actor} baja el arma y sale de la pelea.", "Por las palabras de {by}, {actor} ya no quiere más y se aparta.", "{actor} se aleja de su propio bando, harto de luchar.", "{actor} envaina el arma y mira desde el borde.", "{actor} da la espalda a la pelea; ahora no toma partido."],
  standAsideAgain: ["{actor} se calma y se aparta de la pelea.", "{by} tranquiliza a {actor}, que se aparta de nuevo.", "{actor} lo deja estar y se aparta otra vez.", "La ira de {actor} se apaga; retrocede.", "{actor}, a regañadientes, vuelve a no tomar partido."],
  nearlyTurns: ["{actor} duda, a punto de dejarse ganar por {by}, pero no se vuelve contra los suyos.", "Por un momento {actor} parece a punto de cambiar de bando, y luego niega con la cabeza.", "{by} casi convence a {actor}, pero las viejas lealtades aguantan.", "{actor} vacila, y luego se queda con los suyos.", "{actor} casi escucha a {by}, pero no del todo."],
  watchNeutral: ["{actor} observa sin tomar partido.", "{actor} se mantiene al margen, por ahora.", "{actor} mira, con recelo de ambos bandos.", "{actor} se mantiene apartado, observando con atención.", "{actor} no toma partido, pero no pierde detalle."],
  offended: ["{actor} ya ha visto bastante y se vuelve contra {by} y sus amigos.", "{actor} no lo tolera, y va a por el bando de {by}.", "Se acabó: {actor} va a por {by} y compañía.", "La paciencia de {actor} con {by} y sus amigos se agota.", "{actor} se toma lo que hizo {by} como algo personal y se une a la pelea contra ese bando."],
  offendedHurt: ["Herido por {by}, {actor} se vuelve contra {by} y sus amigos.", "{actor} no quería esta pelea, pero {by} se la ha llevado a su puerta.", "{by} golpea a quien no debía: {actor} se une a la pelea en su contra.", "Con la herida que le hizo {by}, {actor} elige bando: en contra.", "{actor} responde al golpe de {by} uniéndose a la pelea."],
  offendedVictim: ["{actor} no se quedará quieto mientras {by} hace daño a {victim}.", "Al ver herido a {victim}, {actor} se vuelve contra {by} y sus amigos.", "{actor} acude en ayuda de {victim}, contra {by}.", "Era {victim}: {actor} se vuelve contra {by} y sus amigos.", "{actor} va a por {by} por {victim}."],
  offendedRobbed: ["{actor} sorprende a {by} con la mano en su bolsa y se vuelve contra {by}.", "Al robar a {actor}, {by} se ha ganado un enemigo nuevo.", "A {actor} no le roba nadie: va a por {by} y sus amigos.", "Los dedos largos de {by} ponen a {actor} en su contra.", "{actor} agarra la muñeca de {by}, y ahora es una pelea."],
  offendedInsulted: ["Las palabras de {by} sientan fatal: {actor} se vuelve contra {by}.", "Ofendido, {actor} va a por {by} y sus amigos.", "{actor} se ofende con {by} y se une a la pelea en su contra.", "{by} le ha dicho lo que no debía a {actor}.", "{actor} ya ha oído bastante de {by}, y lucha."],
  truce: ["{actor} se encara con {by}, exigiendo una respuesta.", "{actor} se enfrenta a {by}: primero, las palabras.", "{actor} llama la atención a {by}, con la mano en el arma.", "{actor} se planta ante {by}, con rabia pero hablando.", "{actor} exige a {by} que se explique."],
  truceVictim: ["{actor} se enfrenta a {by} por {victim}.", "{actor} exige a {by} que deje en paz a {victim}.", "{actor} le reprocha a {by} lo que le hizo a {victim}.", "{actor} se interpone entre {by} y {victim}, hablando primero.", "{actor} no verá cómo {by} hace daño a {victim}, y lo dice."],
  amends: ["{actor} hace las paces con {by}.", "{actor} se disculpa ante {by}, y basta.", "{by} acepta la disculpa de {actor}.", "{actor} arregla las cosas con {by}.", "{actor} y {by} llegan a un acuerdo."],
  holdsBack: ["{actor} acepta dejarlo estar, a instancias de {by}.", "{by} convence a {actor} de que se eche atrás.", "{actor} baja el arma: {by} tiene razón.", "{actor} lo deja estar, por ahora, como pide {by}.", "Las palabras de {by} contienen a {actor}."],
  feud: ["{actor} se ofende con {target} y va a por {target}.", "{actor} se revuelve contra {target}: esa fue una palabra de más.", "Herido en su orgullo, {actor} se vuelve contra {target}.", "{actor} responde a las palabras de {target} con el acero.", "{actor} no le tolera eso a {target}, y va a por {target}."],
  meddle: ["{actor} habla en favor de {side}.", "{actor} decide intervenir, en nombre de {side}.", "{actor} no puede callarse: se pone del lado de {side}, al menos de palabra.", "{actor} interviene, por {side}.", "{actor} tiene algo que decir, y lo dice por {side}."],
  meddleExtort: ["{actor} ve la ocasión de sacarle algo a {side}.", "{actor} huele dinero en esto, de {side}.", "{actor} quiere que {side} le pague por mantenerse al margen.", "{actor} le pone precio a {side}.", "{actor} echa el ojo a las bolsas de {side}."],
  aloof: ["{actor} se mantiene bien al margen.", "{actor} no quiere saber nada de esto.", "{actor} se queda donde está, sin decir nada.", "{actor} observa y se guarda su opinión.", "{actor} no piensa meterse."],
  peacekeep: ["{actor} intenta calmar los ánimos.", "{actor} se interpone, con las manos en alto: ¡basta!", "{actor} suplica a todos que paren.", "{actor} no piensa quedarse mirando: intenta calmarlo hablando.", "«¡Basta ya!», grita {actor}."],
  calmed: ["{by} convence a {actor}, que lo deja estar.", "{actor} se calma, persuadido por {by}.", "{actor} deja correr el asunto, por ahora.", "Las palabras de {by} enfrían la ira de {actor}.", "{actor} da un paso atrás, convencido por {by}."],
  lapse: ["{actor} deja correr el asunto.", "Sin nadie que responda, {actor} lo deja estar.", "La disputa de {actor} se acaba, por falta de con quién tenerla.", "{actor} se encoge de hombros y se mantiene al margen.", "{actor} lo deja estar."],
  persistent: ["La herida de antes sigue quemando a {actor}.", "{actor} sufre un daño que no cesa.", "La herida sigue haciendo daño a {actor}.", "{actor} no consigue quitarse de encima el daño persistente.", "{actor} sigue sufriendo."],
  afflictionSaveFail: ["{affliction} se apodera de {actor}.", "{actor} nota cómo se extiende {affliction}.", "{actor} se tambalea cuando {affliction} hace efecto.", "{affliction} se filtra en {actor}.", "{affliction} aflige ahora a {actor}."],
  afflictionSavePass: ["{actor} resiste {affliction}.", "{actor} se sacude {affliction}.", "{affliction} no consigue apoderarse de {actor}.", "{actor} vence a {affliction}.", "{affliction} no afecta a {actor}."],
  opportunity: ["{actor} lanza un golpe mientras {target} se retira.", "{target} se da la vuelta, y {actor} se lo hace pagar.", "{actor} aprovecha la ocasión cuando {target} rompe el contacto.", "{target} le deja un hueco a {actor}, y {actor} lo aprovecha.", "{actor} castiga a {target} por darle la espalda."],
  disengage: ["{actor} retrocede con cuidado, con la guardia alta.", "{actor} cede terreno paso a paso, sin dar nunca la espalda.", "{actor} se escurre fuera de alcance.", "{actor} rompe el contacto con cuidado.", "{actor} se aparta poco a poco, con el arma aún en alto."],
  thoughtTwo: ["{actor} {first}, pero también {second}.", "{actor} {first}; una parte de {actor} {second}.", "Por encima de todo, {actor} {first}, pero también {second}.", "{actor} {first}, y en el fondo también {second}.", "{actor} {first}, y aun así {second}."],
  thoughtOne: ["{actor} {first}.", "{actor} {first}, por encima de todo lo demás.", "{actor} {first}, y nada más importa.", "Ahora mismo {actor} {first}.", "En este momento, {actor} {first}."],
  moveDoor: ["{actor} se dirige a la puerta.", "{actor} va hacia la puerta.", "{actor} cruza hasta la puerta.", "{actor} va a la puerta.", "{actor} se planta ante la puerta a grandes zancadas."],
  doorOpen: ["{actor} abre la puerta de par en par.", "{actor} abre la puerta del todo.", "{actor} abre la puerta de un empujón con el hombro.", "{actor} abre la puerta de un tirón.", "La puerta se abre bajo la mano de {actor}."],
  doorForced: ["{actor} embiste la puerta y esta se abre de golpe.", "Con un crujido de madera astillada, {actor} fuerza la puerta.", "{actor} empuja con fuerza, y la puerta cede.", "La cerradura salta cuando {actor} fuerza la puerta.", "{actor} echa la puerta abajo de una patada."],
  doorForcedFail: ["{actor} carga contra la puerta con el hombro, pero aguanta.", "La puerta se estremece bajo el peso de {actor} y aguanta.", "{actor} empuja la puerta, sin resultado.", "{actor} aporrea la puerta, y no se mueve.", "La puerta cruje, pero resiste a {actor}."],
  doorPicked: ["{actor} trabaja la cerradura, y se abre con un clic.", "Unos giros hábiles, y {actor} tiene la cerradura abierta.", "{actor} abre la cerradura en un momento.", "La cerradura cede ante las ganzúas de {actor}.", "{actor} convence a la cerradura de que se abra."],
  doorPickedFail: ["{actor} pelea torpemente con la cerradura.", "La cerradura resiste las ganzúas de {actor}.", "{actor} no consigue que la cerradura ceda.", "Una ganzúa resbala, y {actor} maldice la cerradura.", "{actor} trabaja la cerradura sin suerte."],
  doorSmashed: ["{actor} atraviesa la puerta a hachazos.", "La puerta salta en astillas bajo los golpes de {actor}.", "{actor} hace astillas la puerta.", "Con un último golpe, {actor} echa abajo la puerta.", "{actor} se abre paso a golpes a través de la puerta."],
  doorHit: ["{actor} golpea la puerta; saltan astillas.", "{actor} abre una brecha en la puerta.", "El golpe de {actor} muerde hondo en la puerta.", "{actor} aporrea la puerta, y se agrieta.", "La madera se parte cuando {actor} golpea la puerta."],
  doorMiss: ["{actor} golpea la puerta y el golpe resbala.", "El golpe de {actor} apenas marca la puerta.", "{actor} golpea la puerta con mal ángulo.", "La puerta resiste el golpe de {actor}.", "{actor} golpea la puerta sin mucho efecto."],
  doorGiveUp: ["{actor} se rinde con la puerta cerrada.", "{actor} sacude la puerta cerrada y se da la vuelta.", "La puerta no se abre; {actor} busca otro camino.", "{actor} no piensa perder el tiempo con una puerta cerrada.", "Cerrada. {actor} se da la vuelta."],
  moveTend: ["{actor} corre al lado de {target}.", "{actor} se abre paso para llegar hasta {target}.", "{actor} se agacha y va hacia {target}.", "{actor} acorta la distancia hasta {target}.", "{actor} corre hacia {target}."],
  riderSavePass: ["{actor} no pierde pie.", "{actor} se lo sacude.", "{actor} se afianza y aguanta.", "{actor} se zafa.", "{actor} se mantiene firme."],
  afflictionStage: ["{affliction} empeora en {actor}.", "{actor} sufre por {affliction}.", "{affliction} arde por las venas de {actor}.", "{actor} se dobla por {affliction}.", "{affliction} aprieta su presa sobre {actor}."],
  afflictionEnd: ["{actor} se recupera de {affliction}.", "{affliction} sigue su curso en {actor} y pasa.", "{actor} por fin se libra de {affliction}.", "{affliction} abandona a {actor}.", "{actor} se libra de {affliction}."],
  coverDuck: ["{target} se agacha tras una cobertura.", "{target} se pega a la pared mientras pasa.", "{target} se lanza tras la cobertura justo a tiempo.", "La cobertura salva a {target}.", "{target} se tira tras el muro más cercano."],
  coverShoot: ["{actor} asoma desde su cobertura.", "{actor} aparece por encima del muro.", "Al abrigo del muro, {actor} apunta.", "{actor} se apoya en la piedra para afinar.", "{actor} dispara desde detrás de la cobertura."],
  step: ["{actor} da un paso atrás hacia una posición mejor.", "{actor} se desliza para recolocarse.", "{actor} retrocede bailando fuera de alcance.", "{actor} se recoloca.", "{actor} cede terreno a propósito."],
  victory: ["Cuando se asienta el polvo, {winners} se alzan con la victoria.", "Se acabó. {winners} se llevan la jornada.", "Vuelve el silencio. {winners} han ganado.", "{winners} se imponen.", "La batalla es de {winners}."],
  victoryOne: ["Cuando se asienta el polvo, {winners} se alza con la victoria.", "Se acabó. {winners} se lleva la jornada.", "Vuelve el silencio. {winners} ha ganado.", "{winners} se impone.", "La batalla es de {winners}."],
  lastStanding: ["Cuando termina, solo {winners} sigue en pie.", "{winners} es lo único que queda en pie entre los caídos.", "De todos los presentes, solo {winners} se mantiene en pie.", "Termina con {winners} como último en pie.", "Cae el silencio; solo {winners} sigue en pie."],
  noOne: ["Cuando termina, no queda nadie en pie.", "El silencio cae sobre un campo de caídos.", "Aquí no hay vencedores.", "Todos han caído.", "Nada se mueve cuando termina."],
  stalemate: ["Ningún bando cede, y la pelea sigue y sigue.", "Agotados, los dos bandos se separan.", "Termina en unas amargas tablas.", "Hoy no gana nadie.", "La pelea sigue más allá de toda razón."]
};

/** A character's desires, for its moments of thought: how badly, then what. */
const DESIRE_INTENSITY = {
  passing: ["tiene medio pensado", "se plantea vagamente", "piensa sin mucho empeño en", "siente una leve tentación de", "juega con la idea de"],
  wants: ["tiene ganas de", "querría", "no le importaría", "más bien quiere", "se inclina por"],
  determined: ["pretende", "quiere", "está decidido a", "tiene intención de", "está resuelto a"],
  driven: ["quiere de verdad", "desea con todas sus fuerzas", "se empeña en", "no descansará hasta", "necesita"],
  obsessed: ["solo puede pensar en cómo", "daría cualquier cosa por", "está desesperado por", "arde en deseos de", "se consume por la necesidad de"]
};
const DESIRE_VERB = {
  hurt: ["herir a {target}", "derribar a {target}", "hacérselo pagar a {target}", "llegar hasta {target}", "acabar con {target}"],
  heal: ["curar a {target}", "remendar a {target}", "atender a {target}", "ayudar a {target}", "poner de nuevo en pie a {target}"],
  protect: ["proteger a {target}", "mantener a salvo a {target}", "interponerse entre {target} y el peligro", "cubrir las espaldas de {target}", "escudar a {target}"],
  aid: ["reforzar a {target}", "prestar fuerzas a {target}", "templar el ánimo de {target}", "dar ventaja a {target}", "apuntalar a {target}"],
  talk: ["convencer a {target}", "razonar con {target}", "cruzar unas palabras con {target}", "disuadir a {target}", "hacerse entender por {target}"],
  avoid: ["alejarse de {target}", "mantenerse lejos de {target}", "apartarse de {target}", "poner tierra de por medio con {target}", "evitar a {target}"]
};
/** Desires about itself (healing itself, bolstering itself). */
const DESIRE_SELF = {
  heal: ["curarse", "vendarse las heridas", "recomponerse", "atenderse", "volver a ponerse en pie"],
  aid: ["reforzarse", "darse ventaja", "prepararse para la pelea", "armarse de valor", "concentrarse"]
};

function fill(template, parts) {
  return template.replace(/\{(\w+)\}/g, (m, k) => (parts[k] !== undefined ? parts[k] : m));
}

/** Build every table: key -> 5 entries. */
export function buildSpanishTables() {
  const tables = {};
  for ( const delivery of DELIVERIES ) {
    for ( const type of DAMAGE_TYPES ) {
      const t = TYPE[type];
      for ( const tier of TIERS ) {
        tables[`action.${delivery}.${type}.${tier}`] = SHAPES[delivery][tier].map((shape, i) => fill(shape, {
          aim: DELIVERY[delivery].aim[i % 5],
          hit: t.hit[i % 5], wound: t.wound[(i + 1) % 5], graze: t.graze[i % 5],
          miss: t.miss[i % 5], crit: t.crit[i % 5], botch: t.botch[i % 5]
        }));
      }
    }
  }
  for ( const kind of TALK_KINDS ) {
    for ( const tier of TIERS ) {
      tables[`talk.${kind}.${tier}`] = TALK_SHAPES[tier].map((shape, i) => fill(shape, {
        verb: TALK[kind].verb[i % 5], good: TALK[kind].good[i % 5], bad: TALK[kind].bad[i % 5]
      }));
    }
  }
  for ( const kind of RELATIONSHIPS ) {
    for ( const polarity of ["success", "failure"] ) tables[`relationship.${kind}.${polarity}`] = RELATIONSHIP[kind][polarity];
  }
  for ( const mode of MOVE_MODES ) {
    for ( const situation of MOVE_SITUATIONS ) tables[`move.${mode}.${situation}`] = MOVE[mode][situation];
  }
  for ( const [name, entries] of Object.entries(EVENT) ) tables[`event.${name}`] = entries;
  for ( const [band, entries] of Object.entries(DESIRE_INTENSITY) ) tables[`desire.intensity.${band}`] = entries;
  for ( const [kind, entries] of Object.entries(DESIRE_VERB) ) tables[`desire.verb.${kind}`] = entries;
  for ( const [kind, entries] of Object.entries(DESIRE_SELF) ) tables[`desire.self.${kind}`] = entries;
  return tables;
}
