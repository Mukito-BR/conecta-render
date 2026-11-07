# Conecta: voz, câmera e compartilhamento

Aplicação de demonstração com React/Vite, Express e Socket.io para sinalização WebRTC. O áudio, a câmera e a tela são enviados diretamente entre navegadores. A malha P2P funciona melhor em salas pequenas.

O formulário de entrada permite exigir senha: o primeiro participante cria a sala privada ao entrar com senha; convidados abrem o convite, marcam a opção e informam a senha. O servidor guarda apenas um hash com salt. Os metadados da sala ficam em memória e são apagados quando o processo Render reinicia ou faz novo deploy.

## Rodar neste computador

Abra dois terminais na pasta `projetos\03`.

Terminal 1, servidor:

```powershell
cd .\realtime-room\server
npm install
Copy-Item .env.example .env
npm run dev
```

Terminal 2, cliente:

```powershell
cd .\realtime-room\client
npm install
Copy-Item .env.example .env
npm run dev
```

Abra <endereço>, permita o microfone, escolha seu nome e entre. Na barra inferior ficam **Mutar mic**, **Ativar câmera**, **Transmitir tela** e **Desconectar**. O popup de captura da tela pode oferecer também o áudio do sistema, dependendo do navegador e do sistema operacional.

Se o navegador já tiver bloqueado o microfone, abra as permissões do site `endereço` no cadeado ao lado do endereço, marque **Microfone: Permitir**, recarregue a página e tente entrar novamente. Autorize a câmera quando ativá-la.

## Deploy no Render

O repositório inclui `render.yaml`. Publique como **Web Service**, que recebe uma URL pública `onrender.com`; não use **Private Service**, que não tem URL pública para seus convidados. O Web Service serve o cliente e o Socket.io no mesmo domínio e usa `/health` como health check. O Render documenta o fluxo em [Web Services](https://render.com/docs/web-services) e os tipos de serviço em [Service Types](https://render.com/docs/service-types).

1. Extraia `conecta-render.zip` e envie os arquivos de dentro para um repositório GitHub. (O Render conecta ao repositório; não importa o ZIP diretamente.)
2. No Render, escolha **New → Blueprint** para aplicar `render.yaml` automaticamente, ou **New → Web Service** e selecione o repositório.
3. Para criação manual, use Build Command `npm install && npm run build` e Start Command `npm start`. Se a raiz do repositório for a pasta `realtime-room` extraída, deixe **Root Directory** em branco/`.`.
4. Aguarde o deploy e abra a URL pública gerada pelo Render. Entre na sala e compartilhe o convite.

Para os amigos entrarem, o serviço precisa estar ativo e público. Esta demo não tem login nem senha de sala: qualquer pessoa com o link/ID consegue tentar entrar. Use uma sala com ID difícil de adivinhar e não compartilhe o link publicamente.

## Testar localmente

O endereço `localhost` só existe no seu computador; o link de convite local não pode ser usado por um amigo no Paraná. Os dois computadores precisam abrir o cliente por um endereço HTTPS público e apontar para um servidor Socket.io também acessível pela internet. O navegador exige HTTPS para câmera e microfone fora de `localhost`.

1. Publique o servidor Node e o cliente em um host com HTTPS, ou exponha ambos por um túnel HTTPS temporário. Mantenha o processo do servidor rodando.
2. No `client/.env`, configure `VITE_SIGNAL_URL` com a URL HTTPS pública do servidor Socket.io, por exemplo `https://sinal.seudominio.com`.
3. No `server/.env`, configure `CLIENT_ORIGIN` com a origem HTTPS pública do cliente, por exemplo `https://sala.seudominio.com`. Para um túnel temporário com domínio que muda, `CLIENT_ORIGIN=*` funciona para teste; restrinja à origem do site em hospedagem permanente.
4. Reinicie o servidor e reconstrua/publique o cliente após alterar as variáveis `VITE_*`.
5. Configure um servidor TURN e preencha `VITE_TURN_URL`, `VITE_TURN_USERNAME` e `VITE_TURN_CREDENTIAL` no ambiente do cliente antes do build. STUN sozinho pode falhar quando algum participante está atrás de NAT restritivo, CGNAT ou firewall.
6. Abra o site público, entre na sala e envie o link **Convidar pessoas**.

`VITE_SIGNAL_URL` e as credenciais TURN são incorporadas ao build do frontend. Use credenciais TURN temporárias e limitadas e não coloque segredos administrativos no cliente. Esta demo não implementa autenticação nem salas privadas; qualquer pessoa com o ID/link pode entrar. Não publique a configuração de teste em uma rede pública sem adicionar autenticação e proteção contra abuso.

## Configuração e WebRTC

- Servidor: `server/.env.example` (`PORT`, `CLIENT_ORIGIN`).
- Cliente: `client/.env.example` (`VITE_SIGNAL_URL` e variáveis TURN comentadas). Em produção, o Socket.io usa por padrão o mesmo domínio da página.
- Saúde do servidor: <http://endereço/health>.

O WebRTC tenta STUN público por padrão. Algumas redes e operadoras usam NAT/CGNAT que bloqueia conexões diretas; nesse caso, configure um servidor TURN para voz, câmera e tela passarem por relay. STUN sem TURN não garante conexão em toda rede. As credenciais TURN do cliente ficam visíveis no bundle; gere credenciais temporárias e limitadas no provedor.
