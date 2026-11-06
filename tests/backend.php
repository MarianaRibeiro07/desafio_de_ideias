<?php
declare(strict_types=1);

require __DIR__ . '/../src/App.php';

use Cti\App;

$path = sys_get_temp_dir() . '/cti-test-' . bin2hex(random_bytes(6)) . '.sqlite';
$testStorage = $path . '-storage';
$app = new App(new PDO('sqlite:' . $path), $testStorage);
$app->initialize();
$_SESSION = [];
$checks = 0;
$loc = ['city' => 'Curitiba', 'state' => 'PR'];
function check(bool $condition, string $message): void {
    global $checks;
    if (!$condition) { throw new RuntimeException($message); }
    $checks++;
    echo "PASS $message\n";
}
function req(string $method, string $path, array $body = [], array $query = [], array $files = []): array {
    global $app;
    if ($method !== 'GET') { $_SERVER['HTTP_X_CSRF_TOKEN'] = $_SESSION['csrf_token'] ?? ''; }
    return $app->handle($method, $path, $body, $query, $files);
}
function login(string $email): void {
    req('GET', '/api/session');
    $r = req('POST', '/api/login', ['email' => $email, 'password' => 'CtiDemo2026!']);
    check($r['status'] === 200, "Login $email");
}
try {
    $seed = $app->db();
    $count = fn(string $sql) => (int)$seed->query($sql)->fetchColumn();
    check($count('SELECT COUNT(*) FROM tickets') === 42 && $count('SELECT COUNT(*) FROM feedbacks') === 31 && $count('SELECT COUNT(*) FROM users') === 9, 'Seed demo tem 42 atendimentos (32 recentes e 10 do periodo anterior), 31 feedbacks e 9 usuarios');
    check($count("SELECT COUNT(*) FROM feedbacks WHERE sentiment='negative' AND rating<=2") >= 3, 'Seed tem feedbacks negativos com notas 1 e 2');
    check($count("SELECT COUNT(*) FROM feedbacks WHERE sentiment='neutral'") >= 1 && $count("SELECT COUNT(*) FROM feedbacks WHERE sentiment='positive'") >= 1, 'Seed tem feedbacks neutros e positivos');
    check($count("SELECT COUNT(*) FROM feedbacks WHERE criticality='critical' AND reviewed=0") >= 3, 'Seed tem pelo menos 3 criticos sem revisao');
    check($count("SELECT COUNT(*) FROM feedbacks f JOIN reviews r ON r.feedback_id=f.id WHERE f.criticality='critical' AND f.reviewed=1") >= 1, 'Seed tem um critico ja revisado com historico');
    check($count("SELECT COUNT(DISTINCT t.team_id) FROM feedbacks f JOIN tickets t ON t.id=f.ticket_id WHERE f.criticality='critical' AND f.reviewed=0") === 2, 'Criticos sem revisao existem nas duas equipes');
    check($count("SELECT COUNT(*) FROM feedbacks WHERE text LIKE '%cancel%'") >= 1 && $count("SELECT COUNT(*) FROM feedbacks WHERE text LIKE '%cobranca indevida%'") >= 1 && $count("SELECT COUNT(*) FROM feedbacks WHERE text LIKE '%ninguem resolveu%'") >= 1 && $count("SELECT COUNT(*) FROM feedbacks WHERE text LIKE '%reclamei varias vezes%'") >= 1 && $count("SELECT COUNT(*) FROM feedbacks WHERE text LIKE '%indisponibilidade%'") >= 1, 'Textos negativos usam as frases de criticidade da entrevista');
    check($count("SELECT COUNT(*) FROM tickets t JOIN feedbacks f ON f.ticket_id=t.id AND f.attempt=t.solution_attempt WHERE t.status='active' AND t.rejected_at IS NOT NULL AND t.solution_attempt=1 AND f.resolved=0 AND f.criticality='critical' AND f.reviewed=0") >= 2, 'Seed tem atendimentos ativos que o cliente disse nao resolver');
    check($count("SELECT COUNT(*) FROM feedbacks WHERE analysis_status='failed' AND analysis_error IS NOT NULL AND sentiment='pending'") >= 1, 'Seed tem analise com falha para o supervisor');
    check($count("SELECT COUNT(DISTINCT team_id) FROM tickets") === 2 && $count('SELECT COUNT(DISTINCT attendant_id) FROM tickets') === 4 && $count('SELECT COUNT(DISTINCT client_id) FROM tickets') >= 5 && $count('SELECT COUNT(DISTINCT channel) FROM tickets') >= 4, 'Seed cobre equipes, atendentes, clientes e canais');
    check($count("SELECT COUNT(*) FROM tickets WHERE id<=32 AND (created_at<'" . gmdate('Y-m-d\TH:i:s', time() - 30 * 86400) . "' OR created_at>'" . gmdate('Y-m-d\TH:i:s\+00:00', time()) . "')") === 0 && $count("SELECT COUNT(DISTINCT substr(created_at,1,10)) FROM tickets WHERE id<=32") >= 20, 'Datas dos 32 atendimentos recentes do seed ficam espalhadas nos ultimos 30 dias');
    $oldFrom = gmdate('Y-m-d\TH:i:s', time() - 55 * 86400); $oldTo = gmdate('Y-m-d\TH:i:s', time() - 31 * 86400);
    $oldFeedbacks = "FROM feedbacks WHERE created_at>='$oldFrom' AND created_at<='$oldTo'";
    check($count("SELECT COUNT(*) $oldFeedbacks") >= 8 && $count("SELECT COUNT(*) FROM feedbacks WHERE created_at<'$oldFrom'") === 0, 'Seed tem pelo menos 8 feedbacks entre 31 e 55 dias atras e nenhum mais antigo');
    check($count("SELECT COUNT(*) $oldFeedbacks AND sentiment='positive'") >= 1 && $count("SELECT COUNT(*) $oldFeedbacks AND sentiment='neutral'") >= 1 && $count("SELECT COUNT(*) $oldFeedbacks AND sentiment='negative'") >= 1, 'Feedbacks do periodo anterior misturam positivos, neutros e negativos');
    check($count("SELECT COUNT(*) FROM feedbacks f JOIN reviews r ON r.feedback_id=f.id WHERE f.criticality='critical' AND f.reviewed=1 AND f.created_at>='$oldFrom' AND f.created_at<='$oldTo'") >= 2 && $count("SELECT COUNT(DISTINCT t.team_id) FROM feedbacks f JOIN tickets t ON t.id=f.ticket_id WHERE f.created_at>='$oldFrom' AND f.created_at<='$oldTo'") === 2, 'Periodo anterior tem pelo menos 2 criticos revisados e cobre as duas equipes');
    check($count("SELECT COUNT(*) FROM tickets t JOIN feedbacks f ON f.ticket_id=t.id WHERE t.id>32 AND t.status='resolved' AND t.solution IS NOT NULL AND t.closure_reason='client_confirmed' AND t.closed_at IS NOT NULL AND f.attempt=t.solution_attempt") === 10 && $count("SELECT COUNT(*) FROM tickets WHERE id>32 AND status<>'resolved'") === 0, 'Os 10 atendimentos do periodo anterior estao resolvidos, com solucao e confirmacao do cliente');
    check($count("SELECT COUNT(*) FROM feedbacks WHERE analysis_status='completed' AND analysis_model<>'demonstracao-sintetica'") === 0, 'Analises do seed se identificam como demonstracao sintetica');
    check($count("SELECT COUNT(*) FROM tickets WHERE channel NOT IN ('Portal','Telefone','E-mail','Chat')") === 0, 'Todo canal do seed e um dos quatro canais da interface');
    check($count("SELECT COUNT(*) FROM feedbacks WHERE text LIKE '%fraude%'") >= 1 && $count("SELECT COUNT(*) FROM feedbacks WHERE text LIKE '%processo%' OR text LIKE '%justica%'") >= 1, 'Seed tem frases de criticidade de fraude e de processo');
    check($count("SELECT COUNT(*) FROM feedbacks WHERE text LIKE '%duas semanas%'") === 0, 'Seed nao contradiz a linha do tempo dos atendimentos');
    $session = req('GET', '/api/session');
    check($session['body']['data']['user'] === null, 'Sessao anonima sem usuario');
    $_SERVER['HTTP_X_CSRF_TOKEN'] = 'invalid';
    $csrf = $app->handle('POST', '/api/login', ['email' => 'rafael@cti.demo', 'password' => 'CtiDemo2026!']);
    check($csrf['status'] === 419, 'CSRF invalido bloqueado');
    check(req('POST', '/api/login', ['email' => 'rafael@cti.demo', 'password' => 'wrong'])['status'] === 401, 'Senha incorreta bloqueada');
    login('rafael@cti.demo');
    $boot = req('GET', '/api/bootstrap')['body']['data'];
    check(count($boot['tickets']) >= 6, 'Seed possui atendimentos do atendente');
    check(count(array_filter($boot['tickets'], fn($t) => $t['attendant_id'] !== $boot['user']['id'])) === 0, 'Atendente so enxerga proprios tickets');
    $seedTitles = array_column(array_filter($boot['notifications'], fn($n) => $n['type'] === 'response'), 'title');
    check(in_array('Resposta atrasada', $seedTitles, true) && in_array('Resposta prevista para hoje', $seedTitles, true), 'Seed deixa ao atendente uma resposta vencida e uma prevista nas proximas 24h');
    login('helena@cti.demo');
    $seedComparison = req('GET', '/api/reports')['body']['data']['comparison'];
    check($seedComparison['previous']['received'] > 0 && $seedComparison['previous']['critical'] >= 2, 'GET /api/reports sem filtros devolve a janela anterior do seed com feedbacks');
    check($seedComparison['current']['received'] === 21 && $seedComparison['current']['negative_percent'] === 42 && $seedComparison['current']['critical'] === 7 && $seedComparison['current']['negative'] === 8, 'Janela atual do seed continua com 21 recebidos, 42% negativos, 7 criticos e 8 negativos');
    login('rafael@cti.demo');
    $new = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Falha no acesso VPN', 'channel' => 'Portal', 'priority' => 'medium', 'category_id' => 1]);
    check($new['status'] === 201, 'Registro de atendimento persistido');
    check(req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Canal fora da lista', 'channel' => 'WhatsApp', 'priority' => 'medium'])['status'] === 422, 'Canal WhatsApp nao e aceito');
    $id = $new['body']['data']['id'];
    check(req('PATCH', "/api/tickets/$id", ['status' => 'resolved'])['status'] === 422, 'Status nao aceita alteracao direta');
    check(req('PATCH', "/api/tickets/$id", ['subject' => 'Falha no acesso VPN corporativo'])['status'] === 200, 'Edicao de dados sem mudar status');
    check(req('POST', "/api/tickets/$id/reply", ['message' => 'Recebemos seu contato e estamos verificando a conexao.'])['status'] === 200, 'Atendente envia resposta sem alterar status');
    check(req('POST', "/api/tickets/$id/solution", ['solution' => 'curta'])['status'] === 422, 'Solucao incompleta bloqueada');
    $sent = req('POST', "/api/tickets/$id/solution", ['solution' => 'Credenciais da VPN renovadas e conexao validada.']);
    check($sent['status'] === 200 && $sent['body']['data']['status'] === 'awaiting_feedback', 'Solucao aguarda confirmacao sem fechar');
    check(req('POST', "/api/tickets/$id/solution", ['solution' => 'Nova tentativa sem autorizacao.'])['status'] === 409, 'Segunda mudanca manual bloqueada');
    $pdo = $app->db();
    $other = (int) $pdo->query('SELECT id FROM tickets WHERE attendant_id <> 1 AND client_id <> 1 LIMIT 1')->fetchColumn();
    check(req('PATCH', "/api/tickets/$other", ['subject' => 'Alteracao indevida'])['status'] === 403, 'Edicao de ticket de outro atendente bloqueada');
    login('lucas@cti.demo');
    $clientTicket = array_values(array_filter(req('GET', '/api/bootstrap')['body']['data']['tickets'], fn($t) => $t['id'] === $id))[0];
    check(str_contains($clientTicket['replies'][0]['message'] ?? '', 'verificando a conexao'), 'Cliente consegue ler resposta enviada pelo atendente');
    check(req('POST', '/api/tickets', ['client_id' => 1])['status'] === 403, 'Cliente nao registra ticket como atendente');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $other, 'rating' => 5, 'resolved' => true, 'mode' => 'quick'])['status'] === 403, 'Cliente nao avalia ticket alheio');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $id, 'rating' => 5, 'resolved' => true, 'mode' => 'text', 'text' => str_repeat('a', 501)])['status'] === 422, 'Limite de 500 caracteres aplicado no servidor');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $id, 'rating' => 5, 'resolved' => true, 'mode' => 'text', 'text' => "1\n2\n3\n4\n5\n6"])['status'] === 422, 'Limite de cinco linhas aplicado no servidor');
    $feedback = req('POST', '/api/feedbacks', ['ticket_id' => $id, 'rating' => 5, 'resolved' => true, 'mode' => 'quick']);
    check($feedback['status'] === 201, 'Feedback rapido sem link nem texto');
    check($pdo->query("SELECT status FROM tickets WHERE id=$id")->fetchColumn() === 'resolved', 'Apenas confirmacao do cliente resolve atendimento');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $id, 'rating' => 5, 'resolved' => true, 'mode' => 'quick'])['status'] === 409, 'Feedback duplicado bloqueado');
    check(req('GET', '/api/reports')['status'] === 403, 'Cliente nao acessa relatorios internos');
    login('rafael@cti.demo');
    $negative = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'VPN continua falhando', 'channel' => 'Portal', 'priority' => 'medium'])['body']['data']['id'];
    req('POST', "/api/tickets/$negative/solution", ['solution' => 'Reconfiguracao do cliente VPN executada.']);
    login('lucas@cti.demo');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $negative, 'rating' => 1, 'resolved' => false, 'mode' => 'text', 'text' => 'Continua sem funcionar e minha operacao esta parada.'])['status'] === 201, 'Cliente informa problema nao resolvido');
    $app->maintenance(new DateTimeImmutable('+4 days'));
    check($pdo->query("SELECT status FROM tickets WHERE id=$negative")->fetchColumn() === 'active', 'Negativa impede fechamento por timeout');
    login('marina@cti.demo');
    check(req('POST', "/api/tickets/$negative/retry", ['solution' => 'Perfil VPN recriado com rotas corretas.', 'justification' => 'O cliente confirmou que a primeira tentativa nao funcionou.'])['status'] === 200, 'Supervisor envia nova solucao justificada apos rejeicao');
    check((int)$pdo->query("SELECT manual_status_changes FROM tickets WHERE id=$negative")->fetchColumn() === 1, 'Nova tentativa supervisor preserva limite do atendente');
    login('lucas@cti.demo');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $negative, 'rating' => 4, 'resolved' => true, 'mode' => 'quick'])['status'] === 201, 'Cliente pode avaliar nova tentativa sem perder feedback anterior');
    check((int)$pdo->query("SELECT COUNT(*) FROM feedbacks WHERE ticket_id=$negative")->fetchColumn() === 2, 'Historico preserva feedback das duas tentativas');
    login('rafael@cti.demo');
    $pending = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Retorno pendente', 'channel' => 'Portal', 'priority' => 'medium'])['body']['data']['id'];
    req('POST', "/api/tickets/$pending/solution", ['solution' => 'Conexao restabelecida e teste registrado.']);
    $deadline = new DateTimeImmutable($pdo->query("SELECT feedback_deadline FROM tickets WHERE id=$pending")->fetchColumn());
    $app->maintenance($deadline->modify('-1 minute'));
    check($pdo->query("SELECT status FROM tickets WHERE id=$pending")->fetchColumn() === 'awaiting_feedback', '71h59 nao fecha atendimento');
    $app->maintenance($deadline);
    check($pdo->query("SELECT status FROM tickets WHERE id=$pending")->fetchColumn() === 'closed_no_response', '72h fecha sem retorno sem contar como resolvido');
    $report = req('GET', '/api/reports')['body']['data'];
    check($report['total_tickets'] > 0 && $report['closed_no_response'] >= 1, 'Relatorio diferencia sem retorno de resolvido');
    check(req('GET', '/api/reports', [], ['team_id' => 2])['body']['data']['total_tickets'] === 0, 'Filtro nao amplia escopo do atendente');
    $expired = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Confirmacao enviada apos prazo', 'channel' => 'Portal', 'priority' => 'medium'])['body']['data']['id'];
    req('POST', "/api/tickets/$expired/solution", ['solution' => 'Conexao restabelecida e validada pela equipe.']);
    $pdo->exec("UPDATE tickets SET feedback_deadline='2020-01-01T00:00:00+00:00' WHERE id=$expired");
    login('lucas@cti.demo');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $expired, 'rating' => 5, 'resolved' => true, 'mode' => 'quick'])['status'] === 409, 'Feedback vencido bloqueado sem consulta previa ao portal');
    check($pdo->query("SELECT status FROM tickets WHERE id=$expired")->fetchColumn() === 'closed_no_response', 'Envio apos prazo encerra como sem retorno');
    check((int)$pdo->query("SELECT COUNT(*) FROM feedbacks WHERE ticket_id=$expired")->fetchColumn() === 0, 'Envio vencido nao registra avaliacao nem resolucao');
    login('rafael@cti.demo');
    check(req('GET', '/api/cases', [], ['q' => 'VPN'])['body']['data'] !== [], 'Autocomplete busca cases reais no banco');
    $cloudCases = req('GET', '/api/cases', [], ['q' => 'nuvem'])['body']['data'];
    check(count(array_filter($cloudCases, fn($c) => $c['category_id'] === 1 || stripos($c['solution'], 'VPN') !== false)) === 0, 'Cases de nuvem nao sugerem credenciais VPN');
    $audioTicket = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Gravacao de feedback VPN', 'channel' => 'Portal', 'priority' => 'medium'])['body']['data']['id'];
    req('POST', "/api/tickets/$audioTicket/solution", ['solution' => 'Tunel VPN reconfigurado e conexao restabelecida.']);
    login('lucas@cti.demo');
    $wavPath = tempnam(sys_get_temp_dir(), 'cti-wav-');
    $writeWav = static function(int $seconds) use ($wavPath): void {
        $data = str_repeat("\0", 16000 * $seconds);
        file_put_contents($wavPath, 'RIFF'.pack('V',36+strlen($data)).'WAVEfmt '.pack('VvvVVvv',16,1,1,8000,16000,2,16).'data'.pack('V',strlen($data)).$data);
        clearstatcache(true, $wavPath);
    };
    $writeWav(61);
    $files = ['audio' => ['tmp_name' => $wavPath, 'error' => 0, 'name' => 'gravacao.wav']];
    $audioBody = ['ticket_id' => $audioTicket, 'rating' => 5, 'resolved' => '1', 'mode' => 'audio'];
    check(req('POST', '/api/feedbacks', $audioBody, [], $files)['status'] === 422, 'Servidor rejeita WAV real com mais de 60 segundos');
    $writeWav(60);
    check(req('POST', '/api/feedbacks', [...$audioBody, 'text' => 'conteudo adicional'], [], $files)['status'] === 422, 'Servidor impede audio e texto no mesmo feedback');
    $audioResponse = req('POST', '/api/feedbacks', $audioBody, [], $files);
    check($audioResponse['status'] === 201, 'Gravacao WAV de 60 segundos recebida');
    $audioId = $audioResponse['body']['data']['id'];
    check(req('GET', "/api/feedbacks/$audioId/audio")['status'] === 200, 'Cliente acessa propria gravacao autenticado');
    login('ana@cti.demo');
    check(req('GET', "/api/feedbacks/$audioId/audio")['status'] === 403, 'Audio privado nao pode ser ouvido por outro cliente');
    @unlink($wavPath);
    login('marina@cti.demo');
    $otherTeamTicket = (int)$pdo->query('SELECT id FROM tickets WHERE team_id=2 LIMIT 1')->fetchColumn();
    $otherTeamFeedback = (int)$pdo->query('SELECT f.id FROM feedbacks f JOIN tickets t ON t.id=f.ticket_id WHERE t.team_id=2 LIMIT 1')->fetchColumn();
    check(req('GET', "/api/tickets/$otherTeamTicket/cases")['status'] === 403, 'Supervisor nao acessa atendimento de outra equipe');
    check(req('POST', "/api/feedbacks/$otherTeamFeedback/review", ['sentiment' => 'positive', 'criticality' => 'regular', 'justification' => 'Revisao fora da equipe deve ser bloqueada.', 'action' => 'Tentativa de alteracao indevida.'])['status'] === 403, 'Supervisor nao revisa feedback de outra equipe');
    $supervisorBoot = req('GET', '/api/bootstrap')['body']['data'];
    check(count(array_filter($supervisorBoot['notifications'], fn($n) => $n['type'] === 'critical')) >= 1, 'Supervisor recebe alerta de criticos ainda sem revisao');
    check(count(array_filter($supervisorBoot['tickets'], fn($t) => $t['team_id'] !== 1)) === 0, 'Supervisor enxerga somente tickets da equipe');
    check(req('GET', '/api/reports', [], ['team_id' => 2])['body']['data']['total_tickets'] === 0, 'Filtro outra equipe nao amplia acesso do supervisor');
    $fid = $feedback['body']['data']['id'];
    check(req('POST', "/api/feedbacks/$fid/review", ['sentiment' => 'positive', 'criticality' => 'regular', 'justification' => 'Conferencia com o retorno do cliente.', 'action' => 'Registro validado pela supervisao.'])['status'] === 200, 'Supervisor revisa feedback da equipe com historico');
    login('helena@cti.demo');
    check(req('POST', "/api/tickets/$id/reply", ['message' => 'Acesso de escrita indevido.'])['status'] === 403, 'Gestor possui leitura sem operar atendimento');
    check(count(req('GET', '/api/reports')['body']['data']['teams']) === 2, 'Gestor compara as duas equipes');
    $export = req('GET', '/api/reports/export');
    check($export['status'] === 200 && str_contains($export['headers']['Content-Type'], 'text/csv'), 'Exportacao CSV disponivel');
    $pdo->exec("UPDATE tickets SET subject='=HYPERLINK(1)' WHERE id=$pending");
    check(str_contains(req('GET', '/api/reports/export')['raw'], "'=HYPERLINK(1)"), 'Exportacao neutraliza formula de planilha');
    $pdo->exec("UPDATE tickets SET created_at='2020-01-01T00:00:00+00:00' WHERE id=$id");
    $today = gmdate('Y-m-d');
    check(req('GET', '/api/reports', [], ['from' => $today, 'to' => $today, 'client_id' => 1, 'q' => 'Falha no acesso VPN corporativo'])['body']['data']['received'] === 1, 'Periodo de feedback usa recebimento mesmo em atendimento antigo');
    $pdo->exec("UPDATE feedbacks SET created_at='2024-01-01T00:00:00+00:00' WHERE id=$fid");
    $privateAudio = $pdo->query("SELECT audio_path FROM feedbacks WHERE id=$audioId")->fetchColumn();
    $pdo->exec("UPDATE feedbacks SET created_at='2024-01-01T00:00:00+00:00' WHERE id=$audioId");
    $app->maintenance();
    check($pdo->query("SELECT text FROM feedbacks WHERE id=$fid")->fetchColumn() === null, 'Retencao remove conteudo antigo');
    check($pdo->query("SELECT justification FROM reviews WHERE feedback_id=$fid")->fetchColumn() === null, 'Retencao remove texto da revisao antiga');
    check(!is_file($testStorage . '/audio/' . $privateAudio), 'Retencao apaga arquivo privado de audio antigo');
    check($pdo->query("SELECT audio_path FROM feedbacks WHERE id=$audioId")->fetchColumn() === null, 'Retencao remove referencia de audio antigo');
    // B1: cadastro de cliente (empresa) pelo atendente
    $clientCount = fn() => (int)$pdo->query('SELECT COUNT(*) FROM clients')->fetchColumn();
    $baseClients = $clientCount();
    req('POST', '/api/logout');
    check(req('POST', '/api/clients', ['name' => 'Telecom Horizonte Sul'])['status'] === 401, 'Cadastro de cliente exige sessao');
    login('rafael@cti.demo');
    $_SERVER['HTTP_X_CSRF_TOKEN'] = 'invalid';
    check($app->handle('POST', '/api/clients', ['name' => 'Telecom Horizonte Sul'])['status'] === 419, 'Cadastro de cliente exige CSRF');
    foreach (['lucas@cti.demo' => 'cliente', 'helena@cti.demo' => 'gestor'] as $email => $role) {
        login($email);
        check(req('POST', '/api/clients', ['name' => 'Telecom Horizonte Sul'])['status'] === 403, "Perfil $role nao cadastra cliente");
    }
    check($clientCount() === $baseClients, 'Cadastro negado nao grava cliente');
    login('marina@cti.demo');
    check(req('POST', '/api/clients', ['name' => 'Cadastro do Supervisor SA', 'city' => 'Recife', 'state' => 'PE'])['status'] === 201, 'Supervisor cadastra cliente');
    check($clientCount() === $baseClients + 1, 'Cadastro do supervisor grava o cliente');
    $baseClients++;
    login('rafael@cti.demo');
    check(req('POST', '/api/clients', ['name' => 'ab'])['status'] === 422, 'Nome de cliente curto rejeitado');
    check(req('POST', '/api/clients', ['name' => '  ab  '])['status'] === 422, 'Tamanho do nome conta apos trim');
    check(req('POST', '/api/clients', ['name' => str_repeat('a', 121)])['status'] === 422, 'Nome de cliente com mais de 120 caracteres rejeitado');
    check(req('POST', '/api/clients', [])['status'] === 422, 'Nome de cliente ausente rejeitado');
    check(req('POST', '/api/clients', ['name' => 123])['status'] === 422, 'Nome de cliente nao textual rejeitado');
    check(req('POST', '/api/clients', ['name' => 'Telecom Horizonte Sul', 'extra' => 1])['status'] === 422, 'Campo extra no cadastro de cliente rejeitado');
    check($clientCount() === $baseClients, 'Cadastro invalido nao grava cliente');
    $createdClient = req('POST', '/api/clients', $loc + ['name' => '  Aurora Solucoes Digitais  ']);
    check($createdClient['status'] === 201 && $createdClient['body']['data']['name'] === 'Aurora Solucoes Digitais' && is_int($createdClient['body']['data']['id']) && array_keys($createdClient['body']['data']) === ['id', 'name', 'city', 'state'], 'Cliente cadastrado responde 201 com id e nome sem espacos nas pontas');
    $newClient = $createdClient['body']['data']['id'];
    $dup = req('POST', '/api/clients', $loc + ['name' => 'AURORA SOLUCOES DIGITAIS']);
    check($dup['status'] === 409 && str_contains($dup['body']['message'], 'ja cadastrado'), 'Nome duplicado sem diferenciar caixa responde 409');
    check(req('POST', '/api/clients', $loc + ['name' => 'grupo aurora logistica'])['status'] === 409, 'Duplicidade vale tambem para cliente do seed');
    check($clientCount() === $baseClients + 1, 'Duplicado nao grava segundo registro');
    check((int)$pdo->query("SELECT COUNT(*) FROM audit_events WHERE event='client_created' AND ticket_id IS NULL AND user_id=1")->fetchColumn() === 1, 'Cadastro de cliente gera auditoria sem atendimento');
    foreach (['rafael@cti.demo' => 'atendente', 'camila@cti.demo' => 'outro atendente', 'marina@cti.demo' => 'supervisor', 'helena@cti.demo' => 'gestor'] as $email => $role) {
        login($email);
        check(in_array($newClient, array_column(req('GET', '/api/bootstrap')['body']['data']['clients'], 'id'), true), "Cliente novo aparece no bootstrap do $role");
    }
    login('rafael@cti.demo');
    $withNew = req('POST', '/api/tickets', ['client_id' => $newClient, 'subject' => 'Primeiro chamado do cliente novo', 'channel' => 'Chat', 'priority' => 'medium']);
    check($withNew['status'] === 201 && $withNew['body']['data']['client_name'] === 'Aurora Solucoes Digitais', 'Atendimento pode ser aberto com o cliente recem cadastrado');

    // B2: status ao registrar o atendimento
    $newTicket = fn(array $extra) => req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Registro com status inicial', 'channel' => 'Telefone', 'priority' => 'medium', ...$extra]);
    $solutionText = 'Credenciais renovadas e conexao validada com o cliente.';
    check($newTicket(['status' => 'resolved'])['status'] === 422, 'Registro como resolvido exige solucao');
    check($newTicket(['status' => 'resolved', 'solution' => 'curta'])['status'] === 422, 'Solucao do registro resolvido tem minimo de 10 caracteres');
    check($newTicket(['status' => 'resolved', 'solution' => str_repeat('a', 2001)])['status'] === 422, 'Solucao do registro resolvido tem maximo de 2000 caracteres');
    check($newTicket(['status' => 'resolved', 'solution' => 12345678901])['status'] === 422, 'Solucao nao textual rejeitada no registro');
    foreach (['closed', 'awaiting_feedback', 'RESOLVED', '', 7, null] as $invalidStatus) {
        check($newTicket(['status' => $invalidStatus, 'solution' => $solutionText])['status'] === 422, 'Status invalido no registro rejeitado: ' . var_export($invalidStatus, true));
    }
    check($newTicket(['status' => 'active', 'solution' => $solutionText])['status'] === 422, 'Solucao com status active rejeitada');
    check($newTicket(['solution' => $solutionText])['status'] === 422, 'Solucao sem status informado rejeitada');
    $ticketsBefore = (int)$pdo->query('SELECT COUNT(*) FROM tickets')->fetchColumn();
    $active = $newTicket(['status' => 'active']);
    check($active['status'] === 201 && $active['body']['data']['status'] === 'active' && (int)$active['body']['data']['manual_status_changes'] === 0 && $active['body']['data']['solution'] === null, 'Status active explicito mantem o comportamento atual');
    $activeId = $active['body']['data']['id'];
    check(req('POST', "/api/tickets/$activeId/solution", ['solution' => $solutionText])['status'] === 200, 'Atendimento active ainda recebe uma solucao depois');
    check(req('POST', "/api/tickets/$activeId/solution", ['solution' => $solutionText])['status'] === 409, 'Atendimento active aceita so uma solucao');
    $before = time();
    $resolved = $newTicket(['status' => 'resolved', 'solution' => "  $solutionText  "]);
    $after = time();
    $r = $resolved['body']['data'] ?? [];
    check($resolved['status'] === 201 && $r['status'] === 'awaiting_feedback' && $r['solution'] === $solutionText, 'Registro como resolvido nasce aguardando confirmacao com a solucao');
    check((int)$r['manual_status_changes'] === 1 && (int)$r['solution_attempt'] === 1 && $r['closed_at'] === null && $r['rejected_at'] === null, 'Registro como resolvido consome a mudanca manual e abre a tentativa 1');
    $sentAt = new DateTimeImmutable($r['solution_sent_at']);
    check($sentAt->getTimestamp() >= $before - 1 && $sentAt->getTimestamp() <= $after + 1 && $r['replied_at'] === $r['solution_sent_at'], 'solution_sent_at e a hora do registro');
    check((new DateTimeImmutable($r['feedback_deadline']))->getTimestamp() - $sentAt->getTimestamp() === 72 * 3600, 'Prazo de feedback e de 72 horas a partir do envio');
    check((int)$pdo->query("SELECT COUNT(*) FROM audit_events WHERE ticket_id={$r['id']} AND event IN ('ticket_created','solution_sent')")->fetchColumn() === 2, 'Registro como resolvido audita criacao e envio da solucao');
    check(req('POST', "/api/tickets/{$r['id']}/solution", ['solution' => 'Nova tentativa sem autorizacao.'])['status'] === 409, 'Registrar como resolvido bloqueia a solucao posterior');
    check(req('PATCH', "/api/tickets/{$r['id']}", ['status' => 'active'])['status'] === 422, 'PATCH continua sem aceitar status');
    $app->maintenance($sentAt->modify('+72 hours')->modify('-1 minute'));
    check($pdo->query("SELECT status FROM tickets WHERE id={$r['id']}")->fetchColumn() === 'awaiting_feedback', 'Prazo conta do envio: 71h59 depois do registro nao fecha');
    $app->maintenance(new DateTimeImmutable($r['feedback_deadline']));
    check($pdo->query("SELECT status FROM tickets WHERE id={$r['id']}")->fetchColumn() === 'closed_no_response', 'Prazo conta do envio: 72h depois do registro fecha sem retorno');
    $resolvedB = $newTicket(['status' => 'resolved', 'solution' => $solutionText])['body']['data']['id'];
    login('lucas@cti.demo');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $resolvedB, 'rating' => 5, 'resolved' => true, 'mode' => 'quick'])['status'] === 201 && $pdo->query("SELECT status FROM tickets WHERE id=$resolvedB")->fetchColumn() === 'resolved', 'Cliente confirma atendimento registrado como resolvido');
    login('rafael@cti.demo');
    check((int)$pdo->query('SELECT COUNT(*) FROM tickets')->fetchColumn() === $ticketsBefore + 3, 'Registros rejeitados nao criaram atendimento');

    // B3: alertas e relatorio por perfil
    $in = fn(int $seconds) => gmdate('Y-m-d\TH:i:s\Z', time() + $seconds);
    $mk = function(array $extra) use ($pdo) {
        $due = $extra['response_due_at'] ?? null; unset($extra['response_due_at']);
        $id = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Alerta por perfil', 'channel' => 'Portal', 'priority' => 'medium', ...$extra])['body']['data']['id'];
        if ($due !== null) { $pdo->prepare('UPDATE tickets SET response_due_at=? WHERE id=?')->execute([$due, $id]); }
        return $id;
    };
    $overdueT = $mk(['response_due_at' => $in(-3600)]);
    $soonT = $mk(['response_due_at' => $in(6 * 3600)]);
    $laterT = $mk(['response_due_at' => $in(3 * 86400)]);
    $awaitT = $mk(['status' => 'resolved', 'solution' => $solutionText]);
    $rejectT = $mk(['status' => 'resolved', 'solution' => $solutionText]);
    $types = fn(array $notes) => array_values(array_unique(array_column($notes, 'type')));
    $notesOf = fn() => req('GET', '/api/bootstrap')['body']['data']['notifications'];
    $forTicket = fn(array $notes, string $type, int $ticket) => array_values(array_filter($notes, fn($n) => $n['type'] === $type && $n['ticket_id'] === $ticket));
    login('lucas@cti.demo');
    $clientNotes = $notesOf();
    check($clientNotes !== [] && $types($clientNotes) === ['feedback'] && count($forTicket($clientNotes, 'feedback', $awaitT)) === 1, 'Cliente continua recebendo apenas pedidos de feedback');
    check(req('POST', '/api/feedbacks', ['ticket_id' => $rejectT, 'rating' => 1, 'resolved' => false, 'mode' => 'quick'])['status'] === 201, 'Cliente informa que nao resolveu para gerar alerta');
    login('rafael@cti.demo');
    $attNotes = $notesOf();
    check(array_diff($types($attNotes), ['response', 'rejected']) === [], 'Atendente recebe somente resposta e nao resolvido');
    check(count($forTicket($attNotes, 'response', $overdueT)) === 1 && $forTicket($attNotes, 'response', $overdueT)[0]['title'] === 'Resposta atrasada', 'Atendente recebe resposta atrasada');
    check(count($forTicket($attNotes, 'response', $soonT)) === 1 && $forTicket($attNotes, 'response', $soonT)[0]['title'] === 'Resposta prevista para hoje', 'Atendente recebe resposta prevista nas proximas 24h');
    check(count($forTicket($attNotes, 'response', $laterT)) === 0, 'Resposta com prazo distante nao alerta');
    check(count($forTicket($attNotes, 'rejected', $rejectT)) === 1, 'Atendente recebe cliente informou que nao resolveu');
    check(req('GET', '/api/reports')['body']['data']['response_overdue'] !== [] && in_array($overdueT, array_column(req('GET', '/api/reports')['body']['data']['response_overdue'], 'id'), true), 'Relatorio do atendente lista respostas vencidas');
    $teamOverdue = (int)$pdo->query("SELECT COUNT(*) FROM tickets WHERE team_id=1 AND status='active' AND replied_at IS NULL AND response_due_at<'" . gmdate('Y-m-d\TH:i:s') . "'")->fetchColumn();
    $teamPending = (int)$pdo->query("SELECT COUNT(*) FROM tickets WHERE team_id=1 AND status='active' AND replied_at IS NULL")->fetchColumn();
    check($teamOverdue >= 1 && $teamPending >= 2, 'Equipe 1 tem respostas pendentes que o supervisor nao deve receber como alerta');
    login('marina@cti.demo');
    $supNotes = $notesOf();
    check(array_diff($types($supNotes), ['critical', 'rejected']) === [] && !in_array('response', $types($supNotes), true), 'Supervisor nunca recebe alerta de resposta');
    check(count($forTicket($supNotes, 'rejected', $rejectT)) === 1 && count($forTicket($supNotes, 'critical', $rejectT)) === 1, 'Supervisor recebe critico sem revisao e nao resolvido da equipe');
    check(req('GET', '/api/reports')['body']['data']['response_overdue'] === [], 'Relatorio do supervisor nao traz respostas vencidas');
    check(req('GET', '/api/reports')['body']['data']['active'] >= 3, 'Relatorio do supervisor mantem os demais indicadores');
    login('diego@cti.demo');
    check(array_diff($types($notesOf()), ['critical', 'rejected']) === [], 'Supervisor da outra equipe recebe so criticos e nao resolvidos');
    login('helena@cti.demo');
    check($notesOf() === [], 'Gestor nunca recebe alertas');
    check(req('GET', '/api/reports')['body']['data']['response_overdue'] === [], 'Relatorio do gestor nao traz respostas vencidas');

    // T1: cliente duplicado, camada de banco e transacao
    login('rafael@cti.demo');
    check((int)$pdo->query("SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='clients_name_nocase'")->fetchColumn() === 1, 'Indice unico clients_name_nocase existe no banco');
    $seqBase = $clientCount();
    check(req('POST', '/api/clients', $loc + ['name' => 'Corrida Sequencial SA'])['status'] === 201, 'Primeiro cadastro sequencial cria o cliente');
    $seqDup = req('POST', '/api/clients', $loc + ['name' => 'CORRIDA SEQUENCIAL SA']);
    check($seqDup['status'] === 409 && $seqDup['body']['message'] === 'Cliente ja cadastrado com esse nome.' && $clientCount() === $seqBase + 1, 'Duplicado sequencial continua 409 com a mesma mensagem');
    $indexError = null;
    try { $pdo->exec("INSERT INTO clients(name) VALUES ('corrida sequencial sa')"); } catch (PDOException $e) { $indexError = $e->getMessage(); }
    check($indexError !== null && str_contains($indexError, 'UNIQUE'), 'INSERT direto com outra caixa viola o indice unico do banco');
    check($clientCount() === $seqBase + 1, 'INSERT recusado pelo indice nao grava linha');
    $accent = req('POST', '/api/clients', $loc + ['name' => "Corrida Sequencial Sa\u{00E7}"]);
    check($accent['status'] === 201, 'Nome que difere por acento segue a checagem em PHP e nao e barrado pelo indice');
    check(req('POST', '/api/clients', $loc + ['name' => "\u{00C1}gora Telecom"])['status'] === 201 && req('POST', '/api/clients', $loc + ['name' => "\u{00C1}GORA TELECOM"])['status'] === 409, 'Caixa fora do ASCII continua barrada pela checagem em PHP');
    $pdo->exec("CREATE TRIGGER t1_race BEFORE INSERT ON clients WHEN NEW.name='Corrida Perdida' BEGIN INSERT INTO clients(name) VALUES ('CORRIDA PERDIDA'); END");
    $auditBefore = (int)$pdo->query("SELECT COUNT(*) FROM audit_events WHERE event='client_created'")->fetchColumn();
    $clientsBefore = $clientCount();
    $lost = req('POST', '/api/clients', $loc + ['name' => 'Corrida Perdida']);
    $pdo->exec('DROP TRIGGER t1_race');
    check($lost['status'] === 409 && $lost['body']['message'] === 'Cliente ja cadastrado com esse nome.', 'Violacao do indice depois da checagem responde o mesmo 409');
    check(!$pdo->inTransaction() && $clientCount() === $clientsBefore && (int)$pdo->query("SELECT COUNT(*) FROM audit_events WHERE event='client_created'")->fetchColumn() === $auditBefore, 'Corrida perdida faz rollback sem deixar transacao aberta, cliente nem auditoria');
    check(req('POST', '/api/clients', $loc + ['name' => 'Corrida Perdida'])['status'] === 201, 'Apos o rollback o mesmo nome pode ser cadastrado');
    $legacyPath = sys_get_temp_dir() . '/cti-legacy-' . bin2hex(random_bytes(6)) . '.sqlite';
    $legacy = new PDO('sqlite:' . $legacyPath);
    $legacy->exec(preg_replace('/^CREATE UNIQUE INDEX[^;]*;/mi', '', file_get_contents(__DIR__ . '/../database/schema.sqlite.sql')));
    $legacy->exec("INSERT INTO clients(name) VALUES ('Legado SA'),('LEGADO SA')");
    $legacy->exec("INSERT INTO users(name,email,password_hash,role) VALUES ('Legado','legado@cti.demo','x','manager')");
    $errorLog = $legacyPath . '.log';
    $previousLog = ini_set('error_log', $errorLog);
    $legacyApp = new App($legacy, $legacyPath . '-storage');
    $legacyApp->initialize();
    ini_set('error_log', (string)$previousLog);
    check((int)$legacy->query("SELECT COUNT(*) FROM sqlite_master WHERE name='clients_name_nocase'")->fetchColumn() === 0 && (int)$legacy->query('SELECT COUNT(*) FROM clients')->fetchColumn() === 2, 'Base legada com duplicatas inicializa sem o indice e sem perder dados');
    check(substr_count((string)file_get_contents($errorLog), 'clients_name_nocase') === 1, 'Falha do indice em base legada gera uma linha no log de erros');
    check((int)$legacy->query("SELECT COUNT(*) FROM sqlite_master WHERE name='feedbacks_analysis_idx'")->fetchColumn() === 1, 'Inicializacao continua ate o fim apos a falha do indice');
    unset($legacyApp, $legacy);
    foreach ([$legacyPath, $errorLog] as $file) { @unlink($file); }

    // T2: base de demonstracao nova, sem as mutacoes acima
    $mainApp = $app;
    $freshPath = sys_get_temp_dir() . '/cti-fresh-' . bin2hex(random_bytes(6)) . '.sqlite';
    $app = new App(new PDO('sqlite:' . $freshPath), $freshPath . '-storage');
    $app->initialize();
    $fresh = $app->db();

    // T3: comparacao com o periodo anterior (mesma base nova, datas controladas)
    $fresh->exec("UPDATE feedbacks SET created_at='2000-01-01T10:00:00+00:00'");
    $place = function(int $id, string $at, string $sentiment, string $criticality) use ($fresh) {
        $fresh->prepare('UPDATE feedbacks SET created_at=?,sentiment=?,criticality=? WHERE id=?')->execute([$at, $sentiment, $criticality, $id]);
    };
    $place(1, '2020-02-29T23:59:59+00:00', 'positive', 'regular');
    $place(2, '2020-03-01T00:00:00+00:00', 'negative', 'critical');
    $place(3, '2020-03-10T23:59:59+00:00', 'negative', 'regular');
    $place(4, '2020-03-10T12:00:00+00:00', 'positive', 'regular');
    $place(5, '2020-03-11T00:00:00+00:00', 'negative', 'critical');
    $place(6, '2020-03-20T23:59:59+00:00', 'positive', 'regular');
    $place(7, '2020-03-20T10:00:00+00:00', 'neutral', 'regular');
    $place(8, '2020-03-21T00:00:00+00:00', 'negative', 'critical');
    $place(9, '2020-03-15T09:00:00+00:00', 'pending', 'regular');
    $comparison = function(string $email, array $query = []) { login($email); $r = req('GET', '/api/reports', [], $query); return $r['body']['data']['comparison'] ?? null; };
    $fixed = ['from' => '2020-03-11', 'to' => '2020-03-20'];
    check($comparison('helena@cti.demo', $fixed) === [
        'current' => ['from' => '2020-03-11', 'to' => '2020-03-20', 'received' => 4, 'negative_percent' => 33, 'critical' => 1, 'negative' => 1],
        'previous' => ['from' => '2020-03-01', 'to' => '2020-03-10', 'received' => 3, 'negative_percent' => 67, 'critical' => 1, 'negative' => 2],
    ], 'Comparacao usa a janela anterior de mesma duracao e inclui as bordas dos dois lados');
    login('helena@cti.demo');
    $mainReport = req('GET', '/api/reports', [], $fixed)['body']['data'];
    check($mainReport['received'] === 4 && $mainReport['analyzed'] === 3 && $mainReport['critical'] === 1 && $mainReport['sentiments'] === ['positive' => 1, 'neutral' => 1, 'negative' => 1], 'Totais principais do relatorio nao mudam com a comparacao');
    $negOnly = $comparison('helena@cti.demo', $fixed + ['sentiment' => 'negative']);
    check($negOnly['current']['received'] === 1 && $negOnly['current']['negative_percent'] === 100 && $negOnly['previous']['received'] === 2 && $negOnly['previous']['negative'] === 2, 'Filtro de sentimento vale nas duas janelas');
    $critOnly = $comparison('helena@cti.demo', $fixed + ['criticality' => 'critical']);
    check($critOnly['current']['received'] === 1 && $critOnly['previous']['received'] === 1 && $critOnly['previous']['critical'] === 1, 'Filtro de criticidade vale nas duas janelas');
    $teamExpected = fn(int $team, string $from, string $to) => (int)$fresh->query("SELECT COUNT(*) FROM feedbacks f JOIN tickets t ON t.id=f.ticket_id WHERE t.team_id=$team AND substr(f.created_at,1,10) BETWEEN '$from' AND '$to'")->fetchColumn();
    foreach (['marina@cti.demo' => 1, 'diego@cti.demo' => 2] as $email => $team) {
        $c = $comparison($email, $fixed);
        check($c['current']['received'] === $teamExpected($team, '2020-03-11', '2020-03-20') && $c['previous']['received'] === $teamExpected($team, '2020-03-01', '2020-03-10'), "Comparacao do supervisor da equipe $team respeita o escopo nas duas janelas");
    }
    $own = $comparison('rafael@cti.demo', $fixed);
    $ownExpected = fn(string $from, string $to) => (int)$fresh->query("SELECT COUNT(*) FROM feedbacks f JOIN tickets t ON t.id=f.ticket_id WHERE t.attendant_id=1 AND substr(f.created_at,1,10) BETWEEN '$from' AND '$to'")->fetchColumn();
    check($own['current']['received'] === $ownExpected('2020-03-11', '2020-03-20') && $own['previous']['received'] === $ownExpected('2020-03-01', '2020-03-10'), 'Comparacao do atendente respeita o proprio escopo');
    $empty = $comparison('helena@cti.demo', ['from' => '2021-01-01', 'to' => '2021-01-10']);
    check($empty['current'] === ['from' => '2021-01-01', 'to' => '2021-01-10', 'received' => 0, 'negative_percent' => 0, 'critical' => 0, 'negative' => 0] && $empty['previous']['from'] === '2020-12-22' && $empty['previous']['to'] === '2020-12-31', 'Janela sem feedbacks devolve zeros e a anterior atravessa o ano');
    check($comparison('helena@cti.demo', ['from' => '2020-03-11'])['current']['to'] === gmdate('Y-m-d'), 'Somente from informado usa os ultimos 30 dias');
    check(req('GET', '/api/reports', [], ['from' => '2026-13-45', 'to' => '2026-14-01'])['status'] === 422, 'Datas impossiveis na comparacao respondem 422');
    $day = fn(int $offset) => gmdate('Y-m-d', time() + $offset * 86400);
    $place(10, $day(0) . 'T08:00:00+00:00', 'negative', 'critical');
    $place(11, $day(-29) . 'T00:00:00+00:00', 'positive', 'regular');
    $place(12, $day(-30) . 'T23:59:59+00:00', 'negative', 'regular');
    $place(13, $day(-59) . 'T00:00:00+00:00', 'negative', 'regular');
    $place(14, $day(-60) . 'T23:59:59+00:00', 'negative', 'critical');
    $default = $comparison('helena@cti.demo');
    check($default === [
        'current' => ['from' => $day(-29), 'to' => $day(0), 'received' => 2, 'negative_percent' => 50, 'critical' => 1, 'negative' => 1],
        'previous' => ['from' => $day(-59), 'to' => $day(-30), 'received' => 2, 'negative_percent' => 100, 'critical' => 0, 'negative' => 2],
    ], 'Sem filtros compara os ultimos 30 dias com os 30 anteriores, com bordas');

    $app = $mainApp;

    // T4: mascaramento por padrao (regex) de CPF, telefone e e-mail
    $mask = fn(string $text) => App::maskSensitive($text);
    foreach (['123.456.789-09', '12345678909'] as $cpf) { check($mask("CPF $cpf.") === 'CPF [CPF omitido].', "CPF $cpf vira marcador e preserva a pontuacao final"); }
    foreach (['(11) 98765-4321', '11 98765-4321', '+55 11 98765-4321', '+5511987654321', '(11)98765-4321', '11 9 8765-4321', '(21) 3456-7890', '21 3456 7890', '55 (11) 98765.4321'] as $phone) { check($mask("ligue $phone agora") === 'ligue [telefone omitido] agora', "Telefone $phone vira marcador"); }
    foreach (['ana@empresa.com', 'joao.silva+cti@mail.empresa.com.br', 'X_y-z@sub-dominio.org'] as $email) { check($mask("escreva para $email.") === 'escreva para [e-mail omitido].', "E-mail $email vira marcador"); }
    check($mask('Meu CPF e 123.456.789-09, telefone (11) 98765-4321 e e-mail ana@x.com.br, protocolo ATD-2026-0001.') === 'Meu CPF e [CPF omitido], telefone [telefone omitido] e e-mail [e-mail omitido], protocolo ATD-2026-0001.', 'Combinacao de CPF, telefone, e-mail e protocolo na mesma frase');
    check($mask('11987654321@teste.com e 123.456.789-09') === '[e-mail omitido] e [CPF omitido]', 'E-mail com digitos no usuario nao vira telefone nem CPF');
    foreach (['ATD-2026-0001', 'FDB-2026-0001', 'atendimento ATD-2026-0032 e feedback FDB-2026-0021', '06/11/2026', '2026-11-06', '2026-11-06T12:00:00-03:00', 'R$ 1.234,56', 'R$ 12.345.678,90', 'no ano de 2026', 'ramal 1234', 'foram 12345 acessos', 'nota 5 de 5', '20261106120000'] as $safe) { check($mask($safe) === $safe, "Nao mascara texto comum: $safe"); }
    check($mask('') === '', 'Texto vazio continua vazio');
    $dirty = 'CPF 123.456.789-09, tel +55 (11) 98765-4321, mail ana@x.com.br, ATD-2026-0001';
    check($mask($mask($dirty)) === $mask($dirty), 'Mascarar duas vezes produz o mesmo texto');
    foreach (['me liga no 98765-4321' => 'me liga no [telefone omitido]', 'celular 987654321' => 'celular [telefone omitido]', 'DDD 011 98765-4321' => 'DDD [telefone omitido]', 'fixo (011) 3456-7890.' => 'fixo [telefone omitido].', 'zap 98765 4321, depois 98765.4321' => 'zap [telefone omitido], depois [telefone omitido]'] as $in => $out) { check($mask($in) === $out, "Telefone sem DDD ou com DDD 0xx vira marcador: $in"); }
    foreach (['protocolo ATD-2026-0033', 'protocolo FDB-2026-0033', 'em 06/11/2026 as 11:50', 'valor R$ 1.234,56', 'valor R$ 9.876,54', 'CEP 09890-000', 'IP 192.168.0.10', 'IP 10.9.8.7', 'ramal 98765', 'codigo 9876', 'ano 2026 e 1999', 'pedido 12-34'] as $safe) { check($mask($safe) === $safe, "Nao mascara falso positivo: $safe"); }
    check($mask($mask('liga 98765-4321 ou DDD 011 98765-4321')) === 'liga [telefone omitido] ou DDD [telefone omitido]', 'Mascarar telefone sem DDD duas vezes produz o mesmo texto');
    login('rafael@cti.demo');
    $maskTicket = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => 'Mascaramento no feedback', 'channel' => 'Portal', 'priority' => 'medium'])['body']['data']['id'];
    req('POST', "/api/tickets/$maskTicket/solution", ['solution' => 'Conexao restabelecida e teste registrado.']);
    login('lucas@cti.demo');
    $maskBody = ['ticket_id' => $maskTicket, 'rating' => 2, 'resolved' => true, 'mode' => 'text', 'text' => 'Urgente: meu CPF 123.456.789-09, tel (11) 98765-4321, mail ana@x.com.br. Ref ATD-2026-0001.'];
    $maskFeedback = req('POST', '/api/feedbacks', $maskBody);
    $maskedText = 'Urgente: meu CPF [CPF omitido], tel [telefone omitido], mail [e-mail omitido]. Ref ATD-2026-0001.';
    check($maskFeedback['status'] === 201 && $maskFeedback['body']['data']['text'] === $maskedText, 'Resposta do feedback devolve o texto ja mascarado');
    $maskRow = $pdo->query('SELECT text,criticality FROM feedbacks WHERE id=' . (int)$maskFeedback['body']['data']['id'])->fetch();
    check($maskRow['text'] === $maskedText && $maskRow['criticality'] === 'critical', 'Texto gravado no banco ja mascarado e a criticidade continua calculada');
    check(!str_contains(json_encode($pdo->query('SELECT * FROM feedbacks WHERE id=' . (int)$maskFeedback['body']['data']['id'])->fetch()), '98765'), 'Nenhuma coluna do feedback guarda o telefone original');

    // T5: exclusao sob demanda pelo comando redact
    $cli = function(array $args) use ($path, $testStorage): array {
        $process = proc_open([PHP_BINARY, __DIR__ . '/../bin/console.php', ...$args], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, [...getenv(), 'CTI_DB_PATH' => $path, 'CTI_STORAGE_PATH' => $testStorage]);
        $out = stream_get_contents($pipes[1]); $err = stream_get_contents($pipes[2]);
        fclose($pipes[1]); fclose($pipes[2]);
        return [proc_close($process), $out, $err];
    };
    $redactId = (int)$maskFeedback['body']['data']['id'];
    $redactTicket = (int)$pdo->query("SELECT ticket_id FROM feedbacks WHERE id=$redactId")->fetchColumn();
    @mkdir($testStorage . '/audio', 0700, true);
    file_put_contents($testStorage . '/audio/redact-teste.wav', 'conteudo privado');
    $pdo->exec("UPDATE feedbacks SET audio_path='redact-teste.wav',transcript='fala privada',summary='resumo privado',topics='[\"privado\"]',evidence='[\"privado\"]',original_summary='resumo original privado',analysis_error='erro privado',analysis_status='failed',sentiment='negative',original_sentiment='negative' WHERE id=$redactId");
    login('marina@cti.demo');
    check(req('POST', "/api/feedbacks/$redactId/review", ['sentiment' => 'negative', 'criticality' => 'critical', 'justification' => 'Justificativa privada do supervisor.', 'action' => 'Acao privada do supervisor.'])['status'] === 200, 'Revisao com texto privado criada antes da exclusao');
    [$code, $out, $err] = $cli(['redact', "--feedback=$redactId"]);
    $result = json_decode($out, true);
    check($code === 0 && ($result['status'] ?? null) === 'redacted' && ($result['feedback_id'] ?? null) === $redactId && !empty($result['redacted_at']), 'Comando redact imprime JSON com o resultado');
    $after = $pdo->query("SELECT * FROM feedbacks WHERE id=$redactId")->fetch();
    check($after['text'] === null && $after['transcript'] === null && $after['summary'] === null && $after['topics'] === null && $after['evidence'] === null && $after['original_summary'] === null && $after['analysis_error'] === null && $after['audio_path'] === null, 'Redact remove texto, transcricao, resumo, temas, evidencias e referencia de audio');
    check($after['redacted_at'] === $result['redacted_at'] && $after['analysis_status'] === 'not_required', 'Redact define redacted_at e tira a analise da fila');
    check((int)$after['rating'] === 2 && $after['sentiment'] === 'negative' && $after['original_sentiment'] === 'negative' && $after['criticality'] === 'critical' && (int)$after['reviewed'] === 1 && $after['mode'] === 'text', 'Redact preserva os dados estruturais dos indicadores');
    check(!is_file($testStorage . '/audio/redact-teste.wav'), 'Redact apaga o arquivo de audio privado');
    check(($result['audio_removed'] ?? null) === true, 'Redact com arquivo real devolve audio_removed true');
    $reviewAfter = $pdo->query("SELECT justification,action,sentiment FROM reviews WHERE feedback_id=$redactId")->fetch();
    check($reviewAfter['justification'] === null && $reviewAfter['action'] === null && $reviewAfter['sentiment'] === 'negative', 'Redact apaga o texto da revisao e preserva a classificacao');
    $audit = $pdo->query("SELECT ticket_id,user_id FROM audit_events WHERE event='content_redacted'")->fetchAll();
    check(count($audit) === 1 && (int)$audit[0]['ticket_id'] === $redactTicket && $audit[0]['user_id'] === null, 'Redact registra um evento content_redacted ligado ao atendimento');
    [$code, $out] = $cli(['redact', "--feedback=$redactId"]);
    check($code === 0 && (json_decode($out, true)['status'] ?? null) === 'already_redacted' && (int)$pdo->query("SELECT COUNT(*) FROM audit_events WHERE event='content_redacted'")->fetchColumn() === 1, 'Redact repetido responde already_redacted sem duplicar a auditoria');
    check((json_decode($out, true)['audio_removed'] ?? null) === false, 'Redact repetido devolve audio_removed false');
    check($pdo->query("SELECT redacted_at FROM feedbacks WHERE id=$redactId")->fetchColumn() === $result['redacted_at'], 'Redact repetido nao muda o redacted_at');
    [$code, $out, $err] = $cli(['redact', '--feedback=99999999']);
    check($code !== 0 && $out === '' && str_contains($err, 'Feedback 99999999 nao encontrado'), 'Feedback inexistente sai com codigo nao zero e mensagem clara');
    [$code, , $err] = $cli(['redact']);
    check($code !== 0 && str_contains($err, '--feedback=ID'), 'Redact sem --feedback explica o uso');
    [$code, , $err] = $cli(['redact', '--feedback=abc']);
    check($code !== 0 && str_contains($err, '--feedback=ID'), 'Redact com ID nao numerico explica o uso');
    check(req('GET', "/api/feedbacks/$redactId/audio")['status'] === 404, 'Audio de feedback apagado responde 404');

    // B-b: audio_removed so e true se o unlink funcionou
    $audioCase = function(string $name, ?callable $prepare) use ($pdo, $testStorage, $app): array {
        login('rafael@cti.demo');
        $tid = req('POST', '/api/tickets', ['client_id' => 1, 'subject' => "Audio $name", 'channel' => 'Portal', 'priority' => 'medium'])['body']['data']['id'];
        req('POST', "/api/tickets/$tid/solution", ['solution' => 'Conexao restabelecida e teste registrado.']);
        login('lucas@cti.demo');
        $fid = (int)req('POST', '/api/feedbacks', ['ticket_id' => $tid, 'rating' => 3, 'resolved' => true, 'mode' => 'text', 'text' => 'Texto para audio.'])['body']['data']['id'];
        $pdo->exec("UPDATE feedbacks SET audio_path='$name' WHERE id=$fid");
        if ($prepare) { $prepare($testStorage . '/audio/' . $name); }
        return [$fid, $app->redactFeedback($fid)];
    };
    [$fidMissing, $missing] = $audioCase('inexistente.wav', null);
    check($missing['status'] === 'redacted' && $missing['audio_removed'] === false, 'Audio referenciado mas ausente no disco devolve audio_removed false');
    $logAudio = $path . '-audio.log'; $prevLog = ini_set('error_log', $logAudio);
    [$fidDir, $dirResult] = $audioCase('falha-unlink', fn(string $p) => mkdir($p, 0700, true));
    ini_set('error_log', (string)$prevLog);
    $loggedAudio = (string)@file_get_contents($logAudio); @unlink($logAudio);
    check($dirResult['status'] === 'redacted' && $dirResult['audio_removed'] === false && is_dir($testStorage . '/audio/falha-unlink'), 'Falha do unlink devolve audio_removed false e o conteudo continua redigido');
    check(substr_count($loggedAudio, 'falha-unlink') === 1 && !str_contains($loggedAudio, $testStorage), 'Falha do unlink grava uma linha no log com o nome do arquivo e sem o caminho completo');
    check($app->redactFeedback($fidDir)['status'] === 'already_redacted' && $app->redactFeedback($fidMissing)['audio_removed'] === false, 'Redact continua idempotente depois da falha do audio');
    @rmdir($testStorage . '/audio/falha-unlink');


    // N: prioridade, nivel de suporte, localizacao, relatorios novos e backup (base nova e isolada)
    $nDir = sys_get_temp_dir() . '/cti-new-' . bin2hex(random_bytes(6));
    mkdir($nDir . '/storage/audio', 0700, true);
    $nDb = $nDir . '/cti.sqlite';
    $prevApp = $app;
    $app = new App(new PDO('sqlite:' . $nDb), $nDir . '/storage');
    $app->initialize();
    $n = $app->db();
    $offsets = ['low' => 28800, 'medium' => 14400, 'high' => 3600, 'critical' => 1800];
    $ts = fn(string $iso) => (new DateTimeImmutable($iso))->getTimestamp();

    // N1: prioridade e prazo calculado no servidor
    $seedRows = $n->query('SELECT id,priority,support_level,created_at,response_due_at FROM tickets')->fetchAll(PDO::FETCH_ASSOC);
    check(array_diff(array_unique(array_column($seedRows, 'priority')), array_keys($offsets)) === [] && count(array_unique(array_column($seedRows, 'priority'))) === 4, 'Seed usa as quatro prioridades e nenhuma invalida');
    $badDue = array_filter($seedRows, fn($r) => $ts($r['response_due_at']) - $ts($r['created_at']) !== ($offsets[$r['priority']] ?? -1));
    check($badDue === [], 'Prazo de resposta do seed segue a tabela de prioridades a partir de created_at');
    check(count(array_filter($seedRows, fn($r) => in_array($r['support_level'], [1, 2, 3], true))) === count($seedRows) && count(array_unique(array_column($seedRows, 'support_level'))) === 3, 'Seed tem atendimentos N1, N2 e N3');
    login('rafael@cti.demo');
    $base = ['client_id' => 1, 'subject' => 'Teste de prioridade', 'channel' => 'Portal'];
    check(req('POST', '/api/tickets', $base)['status'] === 400, 'Prioridade ausente responde 400');
    foreach (['urgent', 'HIGH', '', 3, null, ['high']] as $bad) {
        check(req('POST', '/api/tickets', $base + ['priority' => $bad])['status'] === 400, 'Prioridade invalida responde 400: ' . json_encode($bad));
    }
    foreach ($offsets as $priority => $seconds) {
        $r = req('POST', '/api/tickets', $base + ['priority' => $priority, 'response_due_at' => '2999-01-01T00:00:00Z']);
        $t = $r['body']['data'] ?? [];
        check($r['status'] === 201 && $t['priority'] === $priority && $t['support_level'] === 1 && $ts($t['response_due_at']) - $ts($t['created_at']) === $seconds, "Prioridade $priority calcula prazo de $seconds s no servidor e ignora a data enviada");
    }
    $edit = req('PATCH', "/api/tickets/{$t['id']}", ['subject' => 'Assunto ajustado', 'response_due_at' => '2999-01-01T00:00:00Z']);
    check($edit['status'] === 200 && $edit['body']['data']['response_due_at'] === $t['response_due_at'], 'PATCH ignora data de prazo enviada');
    check(in_array('critical', array_column(req('GET', '/api/bootstrap')['body']['data']['tickets'], 'priority'), true), 'Bootstrap expoe priority nos atendimentos');

    // N2: escalonamento de nivel
    $tid = $t['id'];
    foreach (['rafael@cti.demo' => 'atendente dono', 'helena@cti.demo' => 'gestor', 'diego@cti.demo' => 'supervisor de outra equipe'] as $email => $who) {
        login($email);
        check(req('POST', "/api/tickets/$tid/escalate", ['level' => 2])['status'] === 403, "Escalonar como $who responde 403");
    }
    login('lucas@cti.demo');
    check(req('POST', "/api/tickets/$tid/escalate", ['level' => 2])['status'] === 403, 'Cliente nao escalona');
    login('marina@cti.demo');
    check(req('POST', '/api/tickets/999999/escalate', ['level' => 2])['status'] === 404, 'Escalonar atendimento inexistente responde 404');
    foreach ([[], ['level' => 1], ['level' => 4], ['level' => 0], ['level' => '2x'], ['level' => null], ['level' => 2.5]] as $bad) {
        check(req('POST', "/api/tickets/$tid/escalate", $bad)['status'] === 400, 'Nivel invalido ou que nao aumenta responde 400: ' . json_encode($bad));
    }
    $up = req('POST', "/api/tickets/$tid/escalate", ['level' => 2]);
    check($up['status'] === 200 && $up['body']['data']['support_level'] === 2, 'Supervisor escala de N1 para N2');
    check(req('POST', "/api/tickets/$tid/escalate", ['level' => 2])['status'] === 400 && req('POST', "/api/tickets/$tid/escalate", ['level' => 1])['status'] === 400, 'Nivel igual ou menor responde 400');
    check(req('POST', "/api/tickets/$tid/escalate", ['level' => 3])['status'] === 200 && req('POST', "/api/tickets/$tid/escalate", ['level' => 3])['status'] === 400, 'Escala para N3 e depois nao aceita repetir');
    check((int)$n->query("SELECT COUNT(*) FROM audit_events WHERE ticket_id=$tid AND user_id=2 AND event IN ('ticket_escalated_level_2','ticket_escalated_level_3')")->fetchColumn() === 2, 'Cada escalonamento grava um evento em audit_events');
    check((int)$n->query("SELECT support_level FROM tickets WHERE id=$tid")->fetchColumn() === 3, 'Nivel final persistido no banco');

    // N3: localizacao do cliente
    login('rafael@cti.demo');
    $cl = fn(array $b) => req('POST', '/api/clients', $b);
    check($cl(['name' => 'Cliente Sem Cidade', 'state' => 'SP'])['status'] === 400 && $cl(['name' => 'Cliente Sem Estado', 'city' => 'Santos'])['status'] === 400, 'Cidade e estado sao obrigatorios');
    foreach (['A', str_repeat('a', 81), '', 12, null] as $badCity) { check($cl(['name' => 'Cliente Cidade Ruim', 'city' => $badCity, 'state' => 'SP'])['status'] === 400, 'Cidade invalida responde 400: ' . json_encode($badCity)); }
    foreach (['XX', 'S', 'SPP', '', 12, null, 'S1'] as $badState) { check($cl(['name' => 'Cliente UF Ruim', 'city' => 'Santos', 'state' => $badState])['status'] === 400, 'UF invalida responde 400: ' . json_encode($badState)); }
    check((int)$n->query("SELECT COUNT(*) FROM clients WHERE name LIKE 'Cliente %'")->fetchColumn() === 0, 'Cadastro invalido nao grava cliente');
    $okClient = $cl(['name' => 'Cliente Com Local', 'city' => '  Santos ', 'state' => 'sp']);
    check($okClient['status'] === 201 && $okClient['body']['data']['city'] === 'Santos' && $okClient['body']['data']['state'] === 'SP', 'Cliente aceita cidade e UF, normaliza espacos e caixa');
    $ufs = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
    foreach ($ufs as $i => $uf) { $r = $cl(['name' => "Cliente UF $i", 'city' => 'Cidade', 'state' => $uf]); if ($r['status'] !== 201) { throw new RuntimeException("UF $uf recusada"); } }
    check(count($ufs) === 27, 'As 27 UFs sao aceitas');
    $boot = req('GET', '/api/bootstrap')['body']['data'];
    $localized = array_values(array_filter($boot['clients'], fn($c) => $c['name'] === 'Cliente Com Local'))[0];
    check($localized['city'] === 'Santos' && $localized['state'] === 'SP', 'Bootstrap expoe city e state nos clientes');
    check(count(array_filter($boot['clients'], fn($c) => $c['city'] === null || !in_array($c['state'], $ufs, true))) === 0, 'Todo cliente do seed tem cidade e UF valida');
    $viaTicket = req('POST', '/api/tickets', array_merge($base, ['client_id' => $okClient['body']['data']['id'], 'priority' => 'low']))['body']['data'];
    check($viaTicket['client_city'] === 'Santos' && $viaTicket['client_state'] === 'SP', 'Atendimento expoe client_city e client_state');
    check(array_filter(req('GET', '/api/bootstrap')['body']['data']['tickets'], fn($x) => $x['client_city'] === null) === [], 'Bootstrap traz client_city em todos os atendimentos');

    // N4: relatorios (deadline, by_priority, by_support_level, sem agreement)
    login('helena@cti.demo');
    $rep = fn(array $q = []) => req('GET', '/api/reports', [], $q)['body']['data'];
    $before = $rep();
    check(!array_key_exists('agreement', $before) && array_key_exists('comparison', $before), 'Relatorio nao tem agreement e mantem comparison');
    check(array_keys($before['deadline']) === ['on_time', 'late', 'awaiting_on_time', 'overdue', 'total'] && array_sum(array_slice($before['deadline'], 0, 4)) === $before['deadline']['total'] && $before['deadline']['total'] === $before['total_tickets'], 'deadline tem os cinco campos e as quatro categorias somam o total');
    check(array_keys($before['by_priority']) === ['low', 'medium', 'high', 'critical'] && array_sum($before['by_priority']) === $before['total_tickets'], 'by_priority tem as quatro chaves e soma o total');
    check(array_keys($before['by_support_level']) === [1, 2, 3] && array_sum($before['by_support_level']) === $before['total_tickets'] && str_starts_with(json_encode($before['by_support_level']), '{"1":'), 'by_support_level tem as chaves "1","2","3" e soma o total');
    $expected = ['on_time' => 0, 'late' => 0, 'awaiting_on_time' => 0, 'overdue' => 0];
    $now = time();
    foreach ($n->query('SELECT replied_at,response_due_at FROM tickets')->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $due = $ts($row['response_due_at']);
        $expected[$row['replied_at'] !== null ? ($ts($row['replied_at']) <= $due ? 'on_time' : 'late') : ($due >= $now ? 'awaiting_on_time' : 'overdue')]++;
    }
    check(array_slice($before['deadline'], 0, 4) === $expected && $expected['on_time'] > 0 && $expected['late'] > 0 && $expected['overdue'] > 0 && $expected['awaiting_on_time'] > 0, 'deadline do seed bate com a conta independente e tem as quatro categorias');
    $ids = [];
    login('rafael@cti.demo');
    foreach (['high', 'critical', 'low', 'medium'] as $p) { $ids[$p] = req('POST', '/api/tickets', $base + ['priority' => $p, 'subject' => "Prazo $p"])['body']['data']['id']; }
    $setT = $n->prepare('UPDATE tickets SET response_due_at=?,replied_at=?,support_level=? WHERE id=?');
    $setT->execute([gmdate('c', $now + 600), gmdate('c', $now + 300), 3, $ids['high']]);
    $setT->execute([gmdate('c', $now + 600), gmdate('c', $now + 900), 2, $ids['critical']]);
    $setT->execute([gmdate('c', $now + 3600), null, 1, $ids['low']]);
    $setT->execute([gmdate('c', $now - 3600), null, 1, $ids['medium']]);
    login('helena@cti.demo');
    $after = $rep();
    check($after['deadline']['total'] === $before['deadline']['total'] + 4 && $after['deadline']['on_time'] === $before['deadline']['on_time'] + 1 && $after['deadline']['late'] === $before['deadline']['late'] + 1 && $after['deadline']['awaiting_on_time'] === $before['deadline']['awaiting_on_time'] + 1 && $after['deadline']['overdue'] === $before['deadline']['overdue'] + 1, 'deadline classifica no prazo, atrasado, aguardando no prazo e vencido');
    check($after['by_priority']['high'] === $before['by_priority']['high'] + 1 && $after['by_priority']['critical'] === $before['by_priority']['critical'] + 1 && $after['by_support_level'][3] === $before['by_support_level'][3] + 1 && $after['by_support_level'][2] === $before['by_support_level'][2] + 1, 'by_priority e by_support_level contam os novos atendimentos');
    $none = $rep(['from' => '2999-01-01', 'to' => '2999-12-31']);
    check($none['deadline'] === ['on_time' => 0, 'late' => 0, 'awaiting_on_time' => 0, 'overdue' => 0, 'total' => 0] && $none['by_priority'] === ['low' => 0, 'medium' => 0, 'high' => 0, 'critical' => 0] && $none['by_support_level'] === [1 => 0, 2 => 0, 3 => 0], 'Periodo sem atendimentos zera os tres blocos');
    login('marina@cti.demo');
    $teamRep = $rep();
    check($teamRep['deadline']['total'] === $teamRep['total_tickets'] && $teamRep['deadline']['total'] < $after['deadline']['total'], 'Blocos novos respeitam o escopo do perfil');
    check(req('GET', '/api/reports/export')['status'] === 200, 'Exportacao CSV continua funcionando');

    // N5: backup consistente com retencao
    file_put_contents($nDir . '/storage/audio/a.wav', 'RIFFdemo');
    $dest = $nDir . '/bk';
    foreach (['cti-backup-20200101-000000', 'cti-backup-20200102-000000', 'cti-backup-20200103-000000', 'cti-backup-20200104-000000'] as $old) { mkdir("$dest/$old", 0700, true); file_put_contents("$dest/$old/x.txt", 'x'); }
    mkdir("$dest/outra-pasta", 0700, true);
    $res = $app->backup($dest, 3, new DateTimeImmutable('2026-11-06 14:30:15'));
    check($res['path'] === "$dest/cti-backup-20261106-143015" && is_file($res['path'] . '/cti.sqlite') && $res['bytes'] > 0, 'Backup cria pasta datada com o banco e informa o tamanho');
    $copy = new PDO('sqlite:' . $res['path'] . '/cti.sqlite');
    $same = true;
    foreach (['tickets', 'clients', 'users', 'feedbacks', 'audit_events', 'reviews'] as $table) { $same = $same && $copy->query("SELECT COUNT(*) FROM $table")->fetchColumn() === $n->query("SELECT COUNT(*) FROM $table")->fetchColumn(); }
    check($same && $copy->query('PRAGMA integrity_check')->fetchColumn() === 'ok', 'Banco copiado abre, passa no integrity_check e tem as mesmas contagens');
    check(file_get_contents($res['path'] . '/audio/a.wav') === 'RIFFdemo', 'Backup copia o diretorio de audio');
    $left = array_map('basename', glob("$dest/cti-backup-*"));
    sort($left);
    check($left === ['cti-backup-20200103-000000', 'cti-backup-20200104-000000', 'cti-backup-20261106-143015'] && is_dir("$dest/outra-pasta") && count($res['removed']) === 2, 'Retencao apaga so o excedente mais antigo e preserva pasta alheia');
    unset($copy);
    $cli = function(array $args) use ($nDir, $nDb) {
        $env = ['CTI_DB_PATH' => $nDb, 'CTI_STORAGE_PATH' => $nDir . '/storage', 'SystemRoot' => getenv('SystemRoot') ?: '', 'PATH' => getenv('PATH') ?: ''];
        $proc = proc_open([PHP_BINARY, __DIR__ . '/../bin/console.php', ...$args], [1 => ['pipe', 'w'], 2 => ['pipe', 'w']], $pipes, null, $env);
        $out = stream_get_contents($pipes[1]); $err = stream_get_contents($pipes[2]); fclose($pipes[1]); fclose($pipes[2]);
        return [proc_close($proc), $out, $err];
    };
    [$code, $out, $err] = $cli(['backup', "--dir=$nDir/bk2", '--keep=2']);
    check($code === 0 && preg_match('#cti-backup-\d{8}-\d{6}#', $out) === 1 && preg_match('/\d+(\.\d+)? (B|KB|MB)/', $out) === 1, 'Comando backup imprime caminho e tamanho');
    check($cli(['backup', "--dir=$nDir/bk2", '--keep=0'])[0] === 1 && $cli(['backup', "--dir=$nDir/bk2", '--keep=abc'])[0] === 1, 'Retencao invalida encerra com erro');
    check(count(glob("$nDir/bk2/cti-backup-*")) === 1, 'Retencao invalida nao cria backup');

    // N6: migracao idempotente de banco existente
    $oldDb = $nDir . '/old.sqlite';
    $old = new PDO('sqlite:' . $oldDb);
    $old->exec("CREATE TABLE teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL); CREATE TABLE clients (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL, team_id INTEGER, client_id INTEGER);
      CREATE TABLE tickets (id INTEGER PRIMARY KEY AUTOINCREMENT, protocol TEXT UNIQUE, client_id INTEGER NOT NULL, attendant_id INTEGER NOT NULL, team_id INTEGER NOT NULL, category_id INTEGER, subject TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, response_due_at TEXT NOT NULL, replied_at TEXT, solution TEXT, solution_sent_at TEXT, feedback_deadline TEXT, manual_status_changes INTEGER NOT NULL DEFAULT 0, closed_at TEXT, closure_reason TEXT, solution_attempt INTEGER NOT NULL DEFAULT 0, rejected_at TEXT);
      INSERT INTO teams VALUES (1,'T'); INSERT INTO clients VALUES (1,'Antigo SA'); INSERT INTO users VALUES (1,'U','u@x.com','x','attendant',1,NULL);
      INSERT INTO tickets(client_id,attendant_id,team_id,subject,channel,created_at,response_due_at) VALUES (1,1,1,'Antigo','Portal','2026-01-01T10:00:00+00:00','2026-01-03T10:00:00+00:00')");
    for ($i = 0; $i < 2; $i++) { (new App($old, $nDir . '/old-storage'))->initialize(); }
    $oldRow = $old->query('SELECT priority,support_level,response_due_at FROM tickets')->fetch(PDO::FETCH_ASSOC);
    $oldClient = $old->query('SELECT city,state FROM clients')->fetch(PDO::FETCH_ASSOC);
    check($oldRow === ['priority' => 'medium', 'support_level' => 1, 'response_due_at' => '2026-01-03T10:00:00+00:00'] && $oldClient === ['city' => null, 'state' => null], 'Migracao repetida e idempotente: atendimento antigo vira medium/N1 sem perder o prazo e cliente ganha city/state');
    unset($old);

    $app = $prevApp;
    unset($n, $prevApp);

    echo "\n$checks verificacoes aprovadas.\n";
} finally {
    unset($app, $pdo);
    @unlink($path);
    @unlink($path . '-wal');
    @unlink($path . '-shm');
    if (isset($freshPath)) { @unlink($freshPath); }
    if (isset($nDir) && is_dir($nDir)) { $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($nDir, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST); foreach ($it as $f) { $f->isDir() ? @rmdir($f->getPathname()) : @unlink($f->getPathname()); } @rmdir($nDir); }
    foreach (glob($testStorage . '/audio/*.wav') ?: [] as $file) { @unlink($file); }
    @rmdir($testStorage . '/audio');
    @rmdir($testStorage);
}
