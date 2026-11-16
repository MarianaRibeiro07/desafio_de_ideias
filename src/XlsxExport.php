<?php
declare(strict_types=1);

namespace Cti;

use DateTimeImmutable;
use DateTimeZone;
use RuntimeException;
use ZipArchive;

final class XlsxExport {
    private const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    private const REL='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    private const PKG='http://schemas.openxmlformats.org/package/2006/relationships';
    private const S_DATE=1, S_DECIMAL=2, S_BOLD=3, S_TITLE=4, S_HEADER=5;
    // Cor explicita em vez de estilo de tabela nomeado: sem parte de tema, cada programa inventava a sua.
    private const ZEBRA=[0=>6,self::S_DATE=>7,self::S_DECIMAL=>8];
    private const COLUMNS=[['Protocolo',16],['Assunto',44],['Empresa',28],['Cidade/UF',20],['Equipe',22],['Atendente',22],['Canal',11],['Prioridade',11],['Nível de suporte',16],['Situação',22],['Aberto em',17],['Prazo de resposta',18],['Respondido em',17],['Respondido no prazo',20],['Horas até a primeira resposta',29],['Encerrado em',17],['Motivo do encerramento',30]];
    private const PRIORITY=['low'=>'Baixa','medium'=>'Média','high'=>'Alta','critical'=>'Crítica'];
    private const STATUS=['active'=>'Em atendimento','awaiting_feedback'=>'Aguardando cliente','resolved'=>'Resolvido','closed_no_response'=>'Encerrado sem retorno'];
    private const CLOSURE=['client_confirmed'=>'Confirmado pelo cliente','no_response_72h'=>'Sem retorno do cliente em 72 h'];
    private const ROLE=['attendant'=>'Atendente','supervisor'=>'Supervisor','manager'=>'Gestor','client'=>'Cliente'];
    private DateTimeZone $tz;

    public function __construct() { $this->tz=new DateTimeZone('America/Sao_Paulo'); }

    public function build(array $tickets, array $q, string $role): string {
        $now=new DateTimeImmutable('now');
        $parts=['[Content_Types].xml'=>$this->contentTypes(),'_rels/.rels'=>$this->rootRels(),'docProps/core.xml'=>$this->core($now),'docProps/app.xml'=>$this->appProps(),
            'xl/workbook.xml'=>$this->workbook(),'xl/_rels/workbook.xml.rels'=>$this->workbookRels(),'xl/styles.xml'=>$this->styles(),
            'xl/worksheets/sheet1.xml'=>$this->ticketsSheet($tickets),'xl/worksheets/_rels/sheet1.xml.rels'=>$this->rels([['rId1',self::REL.'/table','../tables/table1.xml']]),
            'xl/tables/table1.xml'=>$this->table(max(2,count($tickets)+1)),'xl/worksheets/sheet2.xml'=>$this->summarySheet($tickets,$q,$role,$now)];
        $path=tempnam(sys_get_temp_dir(),'cti-xlsx-');$zip=new ZipArchive();
        try {
            if($path===false||$zip->open($path,ZipArchive::OVERWRITE)!==true){throw new RuntimeException('Nao foi possivel montar a planilha.');}
            foreach($parts as $name=>$xml){$zip->addFromString($name,$xml);}
            if(!$zip->close()){throw new RuntimeException('Nao foi possivel montar a planilha.');}
            return (string)file_get_contents($path);
        } finally { if($path!==false){@unlink($path);} }
    }

    private function ticketsSheet(array $tickets): string {
        $rows=[$this->row(1,array_map(fn($c)=>[$c[0],self::S_HEADER],self::COLUMNS))];$r=2;
        foreach($tickets as $t){
            $replied=$t['replied_at']!==null&&$t['replied_at']!=='';
            $rows[]=$this->row($r,[[$t['protocol']],[$t['subject']],[$t['client_name']],[trim(($t['client_city']??'').'/'.($t['client_state']??''),'/')],[$t['team_name']],[$t['attendant_name']],[$t['channel']],
                [self::PRIORITY[$t['priority']]??$t['priority']],['N'.$t['support_level']],[self::STATUS[$t['status']]??$t['status']],
                [$this->serial($t['created_at']),self::S_DATE],[$this->serial($t['response_due_at']),self::S_DATE],[$this->serial($t['replied_at']),self::S_DATE],
                [$replied?(strtotime($t['replied_at'])<=strtotime($t['response_due_at'])?'Sim':'Não'):null],
                [$replied?round((strtotime($t['replied_at'])-strtotime($t['created_at']))/3600,1):null,self::S_DECIMAL],
                [$this->serial($t['closed_at']),self::S_DATE],[self::CLOSURE[$t['closure_reason']??'']??null]],$r%2===1);$r++;
        }
        $cols='';foreach(self::COLUMNS as $i=>[,$w]){$n=$i+1;$cols.="<col min=\"$n\" max=\"$n\" width=\"$w\" customWidth=\"1\"/>";}
        $last=$this->col(count(self::COLUMNS)).max(2,count($tickets)+1);
        return $this->xml('<worksheet xmlns="'.self::NS.'" xmlns:r="'.self::REL.'"><dimension ref="A1:'.$last.'"/><sheetViews><sheetView workbookViewId="0" tabSelected="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>'.$cols.'</cols><sheetData>'.implode('',$rows).'</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><tableParts count="1"><tablePart r:id="rId1"/></tableParts></worksheet>');
    }

    private function summarySheet(array $tickets, array $q, string $role, DateTimeImmutable $now): string {
        $lines=[[['CTI Escuta, exportação de atendimentos',self::S_TITLE]],[],[['Gerado em',self::S_BOLD],[$this->serial($now->format(DATE_ATOM)),self::S_DATE]],[['Perfil',self::S_BOLD],[self::ROLE[$role]??$role]],[]];
        $filters=$this->filters($tickets,$q);
        if(!$filters){$lines[]=[['Filtros',self::S_BOLD],['Nenhum']];}
        else{$lines[]=[['Filtros aplicados',self::S_BOLD]];foreach($filters as [$label,$value]){$lines[]=[[$label,self::S_BOLD],[$value]];}}
        $lines[]=[];$lines[]=[['Total de atendimentos',self::S_BOLD],[count($tickets)]];
        $counts=array_count_values(array_map(fn($t)=>(string)$t['status'],$tickets));
        foreach(self::STATUS as $key=>$label){$lines[]=[[$label,self::S_BOLD],[$counts[$key]??0]];}
        $rows='';foreach($lines as $i=>$cells){$rows.=$cells?$this->row($i+1,$cells):'';}
        return $this->xml('<worksheet xmlns="'.self::NS.'" xmlns:r="'.self::REL.'"><dimension ref="A1:B'.count($lines).'"/><sheetViews><sheetView workbookViewId="0"/></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="2" width="42" customWidth="1"/></cols><sheetData>'.$rows.'</sheetData><pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/></worksheet>');
    }

    private function filters(array $tickets, array $q): array {
        $q=array_filter($q,fn($v)=>is_scalar($v)&&trim((string)$v)!=='');$out=[];
        $date=fn(string $v)=>preg_match('/^(\d{4})-(\d{2})-(\d{2})$/',$v,$m)?"$m[3]/$m[2]/$m[1]":$v;
        // Os nomes vêm das linhas exportadas para não revelar entidade fora do escopo do perfil.
        $name=function(string $key,string $field,string $v)use($tickets){foreach($tickets as $t){if((string)$t[$key]===$v){return $t[$field];}}return '#'.$v;};
        $maps=['sentiment'=>['Sentimento',['positive'=>'Positivo','neutral'=>'Neutro','negative'=>'Negativo','pending'=>'Pendente']],'criticality'=>['Criticidade',['critical'=>'Crítico','regular'=>'Regular']],'mode'=>['Origem',['text'=>'Texto','audio'=>'Áudio','quick'=>'Avaliação rápida']]];
        if(isset($q['from'])){$out[]=['Período de',$date((string)$q['from'])];}
        if(isset($q['to'])){$out[]=['Período até',$date((string)$q['to'])];}
        foreach(['team_id'=>['Equipe','team_name'],'client_id'=>['Cliente','client_name'],'attendant_id'=>['Atendente','attendant_name']] as $key=>[$label,$field]){if(isset($q[$key])){$out[]=[$label,$name($key,$field,(string)$q[$key])];}}
        if(isset($q['channel'])){$out[]=['Canal',(string)$q['channel']];}
        foreach($maps as $key=>[$label,$names]){if(isset($q[$key])){$out[]=[$label,$names[(string)$q[$key]]??(string)$q[$key]];}}
        if(($q['type']??'')==='criticality'){$out[]=['Tipo','Somente críticos'];}
        if(isset($q['q'])){$out[]=['Busca',trim((string)$q['q'])];}
        return $out;
    }

    private function table(int $lastRow): string {
        $ref='A1:'.$this->col(count(self::COLUMNS)).$lastRow;$cols='';
        foreach(self::COLUMNS as $i=>[$name]){$cols.='<tableColumn id="'.($i+1).'" name="'.$this->esc($name).'"/>';}
        return $this->xml('<table xmlns="'.self::NS.'" id="1" name="Atendimentos" displayName="Atendimentos" ref="'.$ref.'" totalsRowShown="0"><autoFilter ref="'.$ref.'"/><tableColumns count="'.count(self::COLUMNS).'">'.$cols.'</tableColumns><tableStyleInfo showFirstColumn="0" showLastColumn="0" showRowStripes="0" showColumnStripes="0"/></table>');
    }

    private function styles(): string {
        $font=fn(string $extra,int $size)=>"<font>$extra<sz val=\"$size\"/><color rgb=\"FF000000\"/><name val=\"Calibri\"/><family val=\"2\"/></font>";
        return $this->xml('<styleSheet xmlns="'.self::NS.'"><numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts><fonts count="4">'.$font('',11).$font('<b/>',11).$font('<b/>',14).'<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF00499C"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEEF3FA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD9E2EF"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/><xf numFmtId="165" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/><tableStyles count="0"/></styleSheet>');
    }

    private function workbook(): string { return $this->xml('<workbook xmlns="'.self::NS.'" xmlns:r="'.self::REL.'"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="Atendimentos" sheetId="1" r:id="rId1"/><sheet name="Resumo" sheetId="2" r:id="rId2"/></sheets></workbook>'); }
    private function workbookRels(): string { return $this->rels([['rId1',self::REL.'/worksheet','worksheets/sheet1.xml'],['rId2',self::REL.'/worksheet','worksheets/sheet2.xml'],['rId3',self::REL.'/styles','styles.xml']]); }
    private function rootRels(): string { return $this->rels([['rId1',self::REL.'/officeDocument','xl/workbook.xml'],['rId2',self::PKG.'/metadata/core-properties','docProps/core.xml'],['rId3',self::REL.'/extended-properties','docProps/app.xml']]); }
    private function rels(array $items): string { $out='';foreach($items as [$id,$type,$target]){$out.="<Relationship Id=\"$id\" Type=\"$type\" Target=\"$target\"/>";}return $this->xml('<Relationships xmlns="'.self::PKG.'">'.$out.'</Relationships>'); }
    private function contentTypes(): string {
        $o=fn(string $part,string $type)=>"<Override PartName=\"/$part\" ContentType=\"application/vnd.openxmlformats-$type+xml\"/>";
        return $this->xml('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'.$o('xl/workbook.xml','officedocument.spreadsheetml.sheet.main').$o('xl/worksheets/sheet1.xml','officedocument.spreadsheetml.worksheet').$o('xl/worksheets/sheet2.xml','officedocument.spreadsheetml.worksheet').$o('xl/styles.xml','officedocument.spreadsheetml.styles').$o('xl/tables/table1.xml','officedocument.spreadsheetml.table').$o('docProps/core.xml','package.core-properties').$o('docProps/app.xml','officedocument.extended-properties').'</Types>');
    }
    private function core(DateTimeImmutable $now): string { $stamp=$now->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');return $this->xml('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Atendimentos CTI Escuta</dc:title><dc:creator>CTI Escuta</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">'.$stamp.'</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">'.$stamp.'</dcterms:modified></cp:coreProperties>'); }
    private function appProps(): string { return $this->xml('<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>CTI Escuta</Application></Properties>'); }

    private function row(int $r, array $cells, bool $zebra=false): string {
        $out='';
        foreach($cells as $i=>$cell){
            [$value,$style]=[$cell[0]??null,$cell[1]??0];if($zebra){$style=self::ZEBRA[$style]??$style;}$ref=$this->col($i+1).$r;$s=$style?" s=\"$style\"":'';
            if($value===null||$value===''){$out.=$style?"<c r=\"$ref\"$s/>":'';}
            elseif(is_int($value)||is_float($value)){$out.="<c r=\"$ref\"$s><v>".$value.'</v></c>';}
            else{$out.="<c r=\"$ref\"$s t=\"inlineStr\"><is><t xml:space=\"preserve\">".$this->esc((string)$value).'</t></is></c>';}
        }
        return "<row r=\"$r\">$out</row>";
    }
    // Serial do Excel no horário de Brasília: o Excel não guarda fuso, então o deslocamento entra no número.
    private function serial(?string $iso): ?float {
        if($iso===null||$iso===''){return null;}
        $local=(new DateTimeImmutable($iso))->setTimezone($this->tz);
        return round(($local->getTimestamp()+$local->getOffset())/86400+25569,8);
    }
    private function col(int $n): string { $s='';while($n>0){$m=($n-1)%26;$s=chr(65+$m).$s;$n=intdiv($n-1,26);}return $s; }
    private function esc(string $v): string { return htmlspecialchars((string)preg_replace('/[^\x{9}\x{A}\x{D}\x{20}-\x{D7FF}\x{E000}-\x{FFFD}\x{10000}-\x{10FFFF}]/u','',$v),ENT_XML1|ENT_QUOTES,'UTF-8'); }
    private function xml(string $body): string { return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'."\r\n".$body; }
}
