import { Card, CardContent } from '@/components/ui/card';
import { Video, Eye, Heart, MessageCircle } from 'lucide-react';

interface KPICardsProps {
  totalVideos: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
}

export function KPICards({ totalVideos, totalViews, totalLikes, totalComments }: KPICardsProps) {
  const formatNumber = (num: number): string => {
    if (num >= 1_000_000) {
      return (num / 1_000_000).toFixed(1) + 'M';
    }
    if (num >= 1_000) {
      return (num / 1_000).toFixed(1) + 'K';
    }
    return num.toLocaleString('pt-BR');
  };

  const avgViews = totalVideos > 0 ? Math.round(totalViews / totalVideos) : 0;
  const avgLikes = totalVideos > 0 ? Math.round(totalLikes / totalVideos) : 0;
  const avgComments = totalVideos > 0 ? Math.round(totalComments / totalVideos) : 0;

  const kpis = [
    {
      label: 'Total de Vídeos',
      value: totalVideos,
      icon: Video,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
    },
    {
      label: 'Total de Views',
      value: totalViews,
      subValue: `Média: ${formatNumber(avgViews)}`,
      icon: Eye,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
    },
    {
      label: 'Total de Curtidas',
      value: totalLikes,
      subValue: `Média: ${formatNumber(avgLikes)}`,
      icon: Heart,
      color: 'text-red-500',
      bgColor: 'bg-red-500/10',
    },
    {
      label: 'Total de Comentários',
      value: totalComments,
      subValue: `Média: ${formatNumber(avgComments)}`,
      icon: MessageCircle,
      color: 'text-purple-500',
      bgColor: 'bg-purple-500/10',
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {kpis.map((kpi) => (
        <Card key={kpi.label}>
          <CardContent className="pt-6">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground">{kpi.label}</p>
                <p className="text-2xl font-bold">{formatNumber(kpi.value)}</p>
                {kpi.subValue && (
                  <p className="text-xs text-muted-foreground mt-1">{kpi.subValue}</p>
                )}
              </div>
              <div className={`p-2 rounded-lg ${kpi.bgColor}`}>
                <kpi.icon className={`h-5 w-5 ${kpi.color}`} />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
