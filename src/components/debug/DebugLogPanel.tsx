import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Bug, ClipboardCopy, Trash2, ChevronDown } from 'lucide-react';
import {
  clearDebugLogs,
  exportDebugLogsText,
  getDebugLogs,
  initConsoleCapture,
  subscribeDebugLogs,
  type DebugLogEntry,
} from '@/lib/debugLogger';

function levelClass(level: DebugLogEntry['level']) {
  switch (level) {
    case 'error':
      return 'text-destructive';
    case 'warn':
      return 'text-amber-600 dark:text-amber-500';
    default:
      return 'text-muted-foreground';
  }
}

export function DebugLogPanel() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<DebugLogEntry[]>(() => getDebugLogs());

  useEffect(() => {
    initConsoleCapture();
    return subscribeDebugLogs(setLogs);
  }, []);

  const errorCount = useMemo(() => logs.filter((l) => l.level === 'error').length, [logs]);

  const copy = async () => {
    const text = exportDebugLogsText(logs);
    await navigator.clipboard.writeText(text);
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="mt-4">
        <Separator />

        <div className="mt-3 flex items-center justify-between gap-3">
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="px-2"
            >
              <Bug className="h-4 w-4 mr-2" />
              Logs ({logs.length}{errorCount ? ` • ${errorCount} erro(s)` : ''})
              <ChevronDown className={`h-4 w-4 ml-2 transition-transform ${open ? 'rotate-180' : ''}`} />
            </Button>
          </CollapsibleTrigger>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={copy}
              disabled={logs.length === 0}
            >
              <ClipboardCopy className="h-4 w-4 mr-2" />
              Copiar
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearDebugLogs}
              disabled={logs.length === 0}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Limpar
            </Button>
          </div>
        </div>

        <CollapsibleContent>
          <div className="mt-3 rounded-md border bg-muted/30">
            <ScrollArea className="h-44">
              <pre className="p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
                {logs.length === 0 ? (
                  <span className="text-muted-foreground">Sem logs ainda. Tente baixar MP4 e abra aqui se der erro.</span>
                ) : (
                  logs
                    .slice(-200)
                    .map((l) => {
                      const t = new Date(l.ts).toLocaleTimeString();
                      return (
                        <div key={l.id} className={levelClass(l.level)}>
                          [{t}] {l.level.toUpperCase()} {l.message}
                        </div>
                      );
                    })
                )}
              </pre>
            </ScrollArea>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
