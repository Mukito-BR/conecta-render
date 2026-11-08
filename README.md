# Conecta: voz, vídeo e chat

Aplicação React/Vite com servidor Express e Socket.io para sinalização WebRTC. Áudio, câmera e tela são transmitidos diretamente entre navegadores; a malha P2P é indicada para grupos pequenos.

Inclui diretório de salas públicas, salas privadas por senha e convite, chat de texto, avatar opcional, volume de saída local, limite de 10 participantes, uma sessão por navegador e apelidos únicos por sala, até 3 salas públicas e 3 privadas por navegador e exclusão pelo criador. Outra aba do mesmo perfil substitui a conexão anterior na mesma sala. Para apagar uma sala privada, o criador precisa informar a senha da sala. Senhas são guardadas no servidor como hash com salt. Salas, mensagens, diretório e cotas ficam em memória e reiniciam com o serviço; conecte um banco de dados se precisar persistência.

## Rodar localmente

Abra dois terminais na pasta do projeto `projetos\03\teste\conecta-render`.

Edite o arquivo `.env` na raiz do projeto para configurar os endereços. Na primeira vez, crie-o copiando o modelo:

```powershell
Copy-Item .env.example .env
```

O modelo define um endereço e uma porta para cada serviço: `APP_SERVER_HOST`/`APP_SERVER_PORT` para o servidor e `APP_CLIENT_HOST`/`APP_CLIENT_PORT` para a interface. `APP_PUBLIC_SERVER_HOST` é o nome ou IP que o navegador usa para alcançar o servidor; para abrir de outro dispositivo na mesma rede, coloque aqui o IP local deste PC e adicione `http://IP_DO_PC:5173` a `APP_CLIENT_ORIGINS`. Em produção, use a URL pública HTTPS do serviço.

Terminal 1:

```powershell
npm run dev:server
```

Terminal 2:

```powershell
npm run dev:client
```

O servidor deve mostrar a porta configurada (padrão 3001). Em desenvolvimento, a porta do servidor fica reservada para API e Socket.io; a interface só é servida pelo Vite na porta configurada (padrão 5173), que falha claramente se estiver ocupada, em vez de abrir outra interface em 5174. Abra <http://localhost:5173> e confira `/health` na porta configurada do servidor. Permita o acesso ao microfone; se negar, ainda será possível entrar na sala e tentar ativá-lo pelo botão **Ativar mic**. A câmera pede permissão ao ser ativada.

Se aparecer `EADDRINUSE`, já existe um processo usando a porta configurada. Feche os terminais antigos do Conecta e inicie apenas um servidor e um cliente. Para alterar portas, edite o mesmo `.env` e reinicie ambos.

O botão **+** abre a criação de sala. Escolha nome e visibilidade; salas privadas exigem senha de pelo menos 6 caracteres. O criador pode apagar as salas próprias pela lixeira. Limites: 3 públicas e 3 privadas por navegador, 10 pessoas por sala. IDs salvos e propriedade ficam no `localStorage`; senhas de sala não são salvas no navegador.

## Deploy no Render

O `render.yaml` configura um **Web Service** que serve o frontend e o Socket.io no mesmo domínio. Use **New → Blueprint** e conecte o repositório do GitHub para aplicar esse arquivo, ou crie **New → Web Service** manualmente com:

- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Health Check Path: `/health`
- Variável `CLIENT_ORIGIN`: `*` (já configurada no Blueprint)

O Render conecta ao GitHub; não importa o ZIP diretamente. Extraia `conecta-render.zip`, envie os arquivos de dentro para um repositório, depois conecte esse repositório no Render. Consulte [Web Services](https://render.com/docs/web-services) e [Blueprints](https://render.com/docs/blueprint-spec).

**Não use Private Service**: ele não tem URL pública para seus amigos acessarem. Quando publicar alterações no GitHub, o Render fará novo deploy. A URL pública pode ser compartilhada para a lista de salas públicas; salas privadas exigem convite e senha.

## Rede e persistência

O aplicativo usa STUN por padrão. Algumas redes (NAT/CGNAT/firewall) precisam de TURN; configure `VITE_TURN_URL`, `VITE_TURN_USERNAME` e `VITE_TURN_CREDENTIAL` antes do build. As credenciais ficam visíveis no bundle do cliente, então use credenciais TURN temporárias e limitadas.

As salas e mensagens são mantidas na memória do serviço: um reinício ou novo deploy limpa o diretório, as mensagens e a cota registrada. Para mantê-las entre reinícios, adicione um banco de dados persistente.

## Arquivos de configuração

- `render.yaml`: criação do Web Service no Render.
- `.env.example`: IPs e portas locais do cliente e do servidor.
- `server/.env.example` e `client/.env.example`: observações para configurações de produção e TURN.
- Health check local: `http://localhost:APP_SERVER_PORT/health` (porta definida no `.env`).
